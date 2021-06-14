import {
  API,
  APIEvent,
  CharacteristicEventTypes,
  CharacteristicSetCallback,
  CharacteristicValue,
  DynamicPlatformPlugin,
  HAP,
  Logging,
  PlatformAccessory,
  PlatformAccessoryEvent,
  PlatformConfig,
  Service,
} from 'homebridge';
import axios from 'axios';
import { Client } from 'node-ssdp';
import { Parser } from 'xml2js';

const PLUGIN_NAME = 'homebridge-naim-uniti-receiver';
const PLATFORM_NAME = 'NaimUnitiPlatform';
const NAIM_API_PORT = 15081;

/*
 * IMPORTANT NOTICE
 *
 * One thing you need to take care of is, that you never ever ever import anything directly from the "homebridge" module (or the "hap-nodejs" module).
 * The above import block may seem like, that we do exactly that, but actually those imports are only used for types and interfaces
 * and will disappear once the code is compiled to Javascript.
 * In fact you can check that by running `npm run build` and opening the compiled Javascript file in the `dist` folder.
 * You will notice that the file does not contain a `... = require("homebridge");` statement anywhere in the code.
 *
 * The contents of the above import statement MUST ONLY be used for type annotation or accessing things like CONST ENUMS,
 * which is a special case as they get replaced by the actual value and do not remain as a reference in the compiled code.
 * Meaning normal enums are bad, const enums can be used.
 *
 * You MUST NOT import anything else which remains as a reference in the code, as this will result in
 * a `... = require("homebridge");` to be compiled into the final Javascript code.
 * This typically leads to unexpected behavior at runtime, as in many cases it won't be able to find the module
 * or will import another instance of homebridge causing collisions.
 *
 * To mitigate this the {@link API | Homebridge API} exposes the whole suite of HAP-NodeJS inside the `hap` property
 * of the api object, which can be acquired for example in the initializer function. This reference can be stored
 * like this for example and used to access all exported variables and classes from HAP-NodeJS.
 */
let hap: HAP;
let Accessory: typeof PlatformAccessory;

export = (api: API) => {
  hap = api.hap;
  Accessory = api.platformAccessory;

  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, NaimUnitiPlatform);
};

type context = {
  ip: string;
  powerOn: boolean;
  currentMediaState: number;
  mute: boolean;
  volume: number;
};


/*
    deviceType: [ 'urn:schemas-upnp-org:device:MediaRenderer:2' ],
    friendlyName: [ 'Ampli' ],
    manufacturer: [ 'Naim Audio' ],
    manufacturerURL: [ 'http://www.naimaudio.com/' ],
    modelDescription: [ 'Naim all-in-one audio player' ],
    modelName: [ 'Uniti Atom' ],
    modelNumber: [ '20-004-0028' ],
    modelURL: [ 'https://www.naimaudio.com/product/uniti-atom' ],
    serialNumber: [ '461540' ],
    UDN: [ 'uuid:716e6e7e-85e8-4076-b210-2d225d709bf0' ],
    iconList: [ [Object] ],
    serviceList: [ [Object] ],
    presentationURL: [ 'http://192.168.0.20/' ],
    'dlna:X_DLNADOC': [ 'DMR-1.50' ]
*/
type receiver = {
  name: string;
  ip_address: string;
  manufacturer?: string;
  manufacturerURL?: string;
  modelName?: string;
  modelNumber?: string;
  serialNumber?: string;
};

class NaimUnitiPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: PlatformConfig;

  private readonly accessories: PlatformAccessory<context>[];
  private readonly receivers: receiver[];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.accessories = [];
    this.receivers = [];

    // probably parse config or something here
    // Find Naim receiver via ssdp
    const ssdp = new Client;
    ssdp.on('response', async (headers, _, rinfo) => {
      this.log.warn('Found device \n%s\n%s', JSON.stringify(headers, null, '  '), JSON.stringify(rinfo, null, '  '));
      const response = await axios({ responseType : 'text', url : headers.LOCATION });
      const xmlParser = new Parser;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      xmlParser.parseString(response.data, (error: any, result: any) => {
        if(error === null) {
          this.log.warn('Parse XML response : %o', result);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const device: any = result.root.device;
          if (device) {
            this.log.warn('Device : %o', device);
            if (device.manufacturer) {
              const manufacturer: string = device.manufacturer[0];
              this.log.warn('Found device from %s', manufacturer);
              if (manufacturer.includes('Naim') ) {
                this.log.warn('Naim device found !');
                this.receivers.push({
                  name: device.friendlyName[0],
                  ip_address: rinfo.address,
                  manufacturer: device.manufacturer[0],
                  manufacturerURL: device.manufacturerURL[0],
                  modelName: device.manufacturerURL[0],
                  modelNumber: device.modelNumber[0],
                  serialNumber: device.manufacturerURL[0],
                });
                const receiver = this.receivers[this.receivers.length - 1];
                this.log.warn('login receiver %s', receiver);
                this.log.warn('%o', receiver);
              }
            }
          } else {
            this.log.error(error);
          }
        }
      });
    });

    ssdp.search('urn:schemas-upnp-org:device:MediaRenderer:2');

    this.log.info('Naim Uniti Platform platform finished initializing!');

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {
      log.info('Naim Uniti platform didFinishLaunching');

      const receivers = this.config.receivers;

      // Remove all receivers that are not in the config file anymore
      this.accessories.forEach(accessory => {
        const needsRemoving = !receivers.some((receiver: { name:string; ip_address: string }) => receiver.name === accessory.displayName && receiver.ip_address === accessory.context.ip);
        if (needsRemoving) {
          this.removeAudioReceiverAccessory(accessory);
        }
      });

      // Add all receivers that are in the config file but not registered
      receivers.forEach((receiver: { name:string; ip_address: string }) => {
        const isRegistered = this.accessories.some(accessory => accessory.displayName === receiver.name);
        if(!isRegistered) {
          this.addAudioReceiverAccessory(receiver.name, receiver.ip_address);
        }
      });
    });
  }

  /*
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory<context>): void {
    this.log('Configuring Uniti accessory %s', accessory.displayName);

    // Push already registered accessory
    this.accessories.push(accessory);
  }

  addAudioReceiverAccessory = (name: string, ip: string) => {
    this.log.info('Adding new accessory with name %s', name);

    // uuid must be generated from a unique but not changing data source, name should not be used in the most cases. But works in this specific example.
    const receiverUuid = hap.uuid.generate('receiver'+name);
    const receiverAccessory = new Accessory<context>(
      name,
      receiverUuid,
      hap.Categories.AUDIO_RECEIVER,
    );

    receiverAccessory.context = {
      ip: ip,
      powerOn: false,
      currentMediaState: hap.Characteristic.CurrentMediaState.STOP,
      mute: false,
      volume: 0,
    };

    this.setServices(receiverAccessory)
      .then( () => {
        //this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.api.publishExternalAccessories(PLUGIN_NAME, [receiverAccessory]);
        this.accessories.push(receiverAccessory);
      });

  };

  removeAudioReceiverAccessory = (accessory: PlatformAccessory<context>) => {
    this.log.info('Removing accessory with name %s', accessory.displayName);

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.splice(0, 1, accessory);
  };

  setServices = async (receiver: PlatformAccessory<context>) => {
    if (!receiver.context || !receiver.context.ip) {
      this.log.error('No IP Address configured on %s', receiver.displayName);
      return;
    }

    this.log.debug('setServices');
    const baseURL = 'http://' + receiver.context.ip + ':' + NAIM_API_PORT;

    // Utility functions
    const naimApiGet = async (path: string, key: string) => {
      const apiURL = baseURL + path;
      this.log.debug('naimApiCall - GET : ' + key + '@' + apiURL);
      try {
        const response = await axios.get(apiURL);
        return response.data[key] as string;
      } catch (error) {
        handleError(error, apiURL);
      }
    };

    const naimApiPut = async (
      path: string,
      key: string,
      valueToSet: string,
      forceGet = false,
    ) => {
      const apiURL = baseURL + path + '?' + key + '=' + valueToSet;
      this.log.debug(
        'naimApiCall - PUT ' +
          (forceGet ? '(forced)' : '') +
          ' : ' +
          valueToSet +
          ' into ' +
          key +
          '@' +
          apiURL,
      );
      if (!forceGet) {
        axios.put(apiURL).catch((error) => {
          handleError(error, apiURL);
        });
      } else {
        axios.get(apiURL).catch((error) => {
          handleError(error, apiURL);
        });
      }
    };

    const handleError = (error: Error, url = 'N/A') => {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // client received an error response (5xx, 4xx)
          this.log.error(
            'Naim receiver emited a bad response (On : %s - Details : %s)',
            url,
            error.message,
          );
        } else if (error.request) {
          // client never received a response, or request never left
          this.log.error(
            'Naim receiver did not respond. Check the IP Address in your configuration of the plugin. (On : %s - Details : %s)',
            url,
            error.message,
          );
        } else {
          // Not a network error
          this.log.error(
            'Other request error (On : %s - Details : %s)',
            url,
            error.message,
          );
        }
      } else {
        // Not an error from the request
        this.log.error('Problem (On : %s - Details : %s)', url, error.message);
      }
    };

    const atomService = new hap.Service.Television(
      receiver.displayName,
      'Naim Unity',
    );
    atomService
      .getCharacteristic(hap.Characteristic.Active)
      .onGet(async () => {
        naimApiGet('/power', 'system')
          .then((returnedValue) => {
            const isActive = (returnedValue === 'on');
            atomService.updateCharacteristic(
              hap.Characteristic.Active,
              isActive,
            );
            receiver.context.powerOn = isActive;
            return isActive;
          })
          .catch((error) => {
            handleError(error);
            return false;
          });
        return receiver.context.powerOn;
      })
      .onSet(async (value) => {
        const isActive = (value as boolean);
        receiver.context.powerOn = isActive;
        naimApiPut('/power', 'system', isActive ? 'on' : 'lona')
          .catch((error) => {
            handleError(error);
          });
      });

    atomService.setCharacteristic(hap.Characteristic.ActiveIdentifier, 1);
    atomService.setCharacteristic(
      hap.Characteristic.ConfiguredName,
      receiver.displayName,
    );

    atomService
      .getCharacteristic(hap.Characteristic.CurrentMediaState)
      .onGet(async () => {
        let mediaState: number;
        naimApiGet('/nowplaying', 'transportState')
          .then((returnedValue) => {
            switch (returnedValue?.toString()) {
              case '2':
                mediaState = hap.Characteristic.CurrentMediaState.PLAY;
                break;
              case '3':
                mediaState = hap.Characteristic.CurrentMediaState.PAUSE;
                break;
              default:
                mediaState = hap.Characteristic.CurrentMediaState.STOP;
                break;
            }
            receiver.context.currentMediaState = mediaState;
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return hap.Characteristic.CurrentMediaState.STOP;
          });
        // return as soon as possible, update on the resoution of the async function
        return receiver.context.currentMediaState;
      });

    atomService
      .getCharacteristic(hap.Characteristic.TargetMediaState)
      .onGet(async () => {
        let mediaState: number;
        naimApiGet('/nowplaying', 'transportState')
          .then((returnedValue) => {
            switch (returnedValue?.toString()) {
              case '2':
                mediaState = hap.Characteristic.CurrentMediaState.PLAY;
                break;
              case '3':
                mediaState = hap.Characteristic.CurrentMediaState.PAUSE;
                break;
              default:
                mediaState = hap.Characteristic.CurrentMediaState.STOP;
                break;
            }
            atomService.updateCharacteristic(
              hap.Characteristic.CurrentMediaState,
              mediaState,
            );
            receiver.context.currentMediaState = mediaState;
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return receiver.context.currentMediaState;
          });
        // return as soon as possible, update on the resoution of the async function
        return receiver.context.currentMediaState;
      })
      .onSet(async () => {
        naimApiPut('/nowplaying', 'cmd', 'playpause', true)
          .catch((error) => {
            handleError(error);
            (receiver.context.currentMediaState === 0) ? 1 : 0;
          });
        (receiver.context.currentMediaState === 0) ? 1 : 0;
      });

    //const atomSpeakerService = new hap.Service.SmartSpeaker(receiver.displayName + 'Service');

    atomService
      .getCharacteristic(hap.Characteristic.Mute)
      .onGet(async () => {
        naimApiGet('/levels/room', 'mute')
          .then((returnedValue) => {
            const isMuted = returnedValue === '1';
            receiver.context.mute = isMuted;
            return isMuted;
          })
          .catch((error) => {
            handleError(error);
            return receiver.context.mute;
          });
        return receiver.context.mute;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'mute', value as string).catch((error) => {
          handleError(error);
          receiver.context.mute = !receiver.context.mute;
        });
        receiver.context.mute = !receiver.context.mute;
      });

    atomService
      .getCharacteristic(hap.Characteristic.Volume)
      .onGet(async () => {
        naimApiGet('/levels/room', 'volume')
          .then((returnedValue) => {
            let volume = 0;
            if (returnedValue) {
              volume = +returnedValue;
            }
            receiver.context.volume = volume;
            return volume;
          })
          .catch((error) => {
            handleError(error);
            return 0;
          });
        return receiver.context.volume;
      })
      .onSet(async (value) => {
        const intialVolume = receiver.context.volume;
        naimApiPut('/levels/room', 'volume', value as string).catch((error) => {
          handleError(error);
          receiver.context.volume = intialVolume;
        });
        receiver.context.volume = +value;
      });

    this.log.debug('Adding informationService');
    let receiverInformationService = receiver.getService(hap.Service.AccessoryInformation);
    if (!receiverInformationService) {
      receiverInformationService = receiver.addService(hap.Service.AccessoryInformation);
    }

    receiverInformationService
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Naim')
      .setCharacteristic(hap.Characteristic.Model, 'Uniti Atom');

    const serialNumber = await naimApiGet('/system', 'hardwareSerial');
    if (serialNumber) {
      this.log.debug('Setting serial number %s', serialNumber);
      receiverInformationService.setCharacteristic(hap.Characteristic.SerialNumber, serialNumber);
    }


    // this.log.debug('Adding atomSpeakerService');
    // receiver.addService(atomSpeakerService);
    this.log.debug('Adding atomService');
    receiver.addService(atomService);
    this.log.debug('Finished adding services');

  };

}
