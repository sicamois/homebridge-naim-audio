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
import { Client, SsdpHeaders } from 'node-ssdp';
import { Parser } from 'xml2js';
import { RemoteInfo } from 'dgram';

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

type receiver = {
  name: string;
  ip_address: string;
  manufacturer?: string;
  manufacturerURL?: string;
  modelName?: string;
  modelNumber?: string;
  serialNumber?: string;
  uuid?: string;
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

    this.log.info('Naim Uniti Platform platform finished initializing!');

    /*
     * When this event is fired, homebridge restored all cached accessories from disk and did call their respective
     * `configureAccessory` method for all of them. Dynamic Platform plugins should only register new accessories
     * after this event was fired, in order to ensure they weren't added to homebridge already.
     * This event can also be used to start discovery of new accessories.
     */
    api.on(APIEvent.DID_FINISH_LAUNCHING, () => {

      // Find Naim receiver via ssdp
      const ssdp = new Client;
      ssdp.on('response', (headers: SsdpHeaders, statusCode: number, remoteInfos: RemoteInfo) => {
        this.extractNaimReceiverFrom(headers, remoteInfos, this.addAudioReceiverAccessory);
      });

      this.log.info('Start discovering Naim Audio devices with uPnP');
      ssdp.search('urn:schemas-upnp-org:device:MediaRenderer:2');
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

  // Custom methods

  private readonly extractNaimReceiverFrom = async (headers: SsdpHeaders, remoteInfos: RemoteInfo, andProcessTheReceiver: (receiver: receiver) => void) => {
    const xmlParser = new Parser;

    const response = await axios({ responseType : 'text', url : headers.LOCATION });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xmlParser.parseString(response.data, (error: any, result: any) => {
      if(error === null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const device: any = result.root.device[0];
        if (device) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const manufacturer: string = device.manufacturer[0];
          if (manufacturer && manufacturer.includes('Naim')) {
            const receiver = {
              name: device.friendlyName[0],
              ip_address: remoteInfos.address,
              manufacturer: device.manufacturer[0],
              manufacturerURL: device.manufacturerURL[0],
              modelName: device.modelName[0],
              modelNumber: device.modelNumber[0],
              serialNumber: device.serialNumber[0],
              uuid: device.UDN[0],
            };
            this.log.info('%s discovered ! It is a %s %s', receiver.name, receiver.manufacturer, receiver.modelName);
            andProcessTheReceiver(receiver);
          }
        } else {
          this.log.error(error);
        }
      }
    });
  };

  private addAudioReceiverAccessory = (receiver: receiver) => {
    this.log.info('Configuring new accessory with name %s', receiver.name);

    // uuid must be generated from a unique but not changing data source, name should not be used in the most cases. But works in this specific example.
    const receiverUuid = hap.uuid.generate(receiver.name);
    const receiverAccessory = new Accessory<context>(
      receiver.name,
      receiverUuid,
      hap.Categories.AUDIO_RECEIVER,
    );

    receiverAccessory.context = {
      ip: receiver.name,
      powerOn: false,
      currentMediaState: hap.Characteristic.CurrentMediaState.STOP,
      mute: false,
      volume: 0,
    };

    this.setServices(receiverAccessory, receiver)
      .then( () => {
        this.log.info('Accessory %s fully configured !', receiver.name);
        //this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.api.publishExternalAccessories(PLUGIN_NAME, [receiverAccessory]);
        this.accessories.push(receiverAccessory);
      });

  };

  private readonly setServices = async (accessory: PlatformAccessory<context>, receiver: receiver) => {
    this.log.debug('setServices');
    const baseURL = 'http://' + receiver.ip_address + ':' + NAIM_API_PORT;

    const atomService = new hap.Service.Television(
      accessory.displayName,
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
            accessory.context.powerOn = isActive;
            return isActive;
          })
          .catch((error) => {
            handleError(error);
            return false;
          });
        return accessory.context.powerOn;
      })
      .onSet(async (value) => {
        const isActive = (value as boolean);
        accessory.context.powerOn = isActive;
        naimApiPut('/power', 'system', isActive ? 'on' : 'lona')
          .catch((error) => {
            handleError(error);
          });
      });

    atomService.setCharacteristic(hap.Characteristic.ActiveIdentifier, 1);
    atomService.setCharacteristic(
      hap.Characteristic.ConfiguredName,
      accessory.displayName,
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
            accessory.context.currentMediaState = mediaState;
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return hap.Characteristic.CurrentMediaState.STOP;
          });
        // return as soon as possible, update on the resoution of the async function
        return accessory.context.currentMediaState;
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
            accessory.context.currentMediaState = mediaState;
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return accessory.context.currentMediaState;
          });
        // return as soon as possible, update on the resoution of the async function
        return accessory.context.currentMediaState;
      })
      .onSet(async () => {
        naimApiPut('/nowplaying', 'cmd', 'playpause', true)
          .catch((error) => {
            handleError(error);
            (accessory.context.currentMediaState === 0) ? 1 : 0;
          });
        (accessory.context.currentMediaState === 0) ? 1 : 0;
      });

    atomService
      .getCharacteristic(hap.Characteristic.Mute)
      .onGet(async () => {
        naimApiGet('/levels/room', 'mute')
          .then((returnedValue) => {
            const isMuted = returnedValue === '1';
            accessory.context.mute = isMuted;
            return isMuted;
          })
          .catch((error) => {
            handleError(error);
            return accessory.context.mute;
          });
        return accessory.context.mute;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'mute', value as string).catch((error) => {
          handleError(error);
          accessory.context.mute = !accessory.context.mute;
        });
        accessory.context.mute = !accessory.context.mute;
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
            accessory.context.volume = volume;
            return volume;
          })
          .catch((error) => {
            handleError(error);
            return 0;
          });
        return accessory.context.volume;
      })
      .onSet(async (value) => {
        const intialVolume = accessory.context.volume;
        naimApiPut('/levels/room', 'volume', value as string).catch((error) => {
          handleError(error);
          accessory.context.volume = intialVolume;
        });
        accessory.context.volume = +value;
      });

    this.log.debug('Adding informationService');
    let receiverInformationService = accessory.getService(hap.Service.AccessoryInformation);
    if (!receiverInformationService) {
      receiverInformationService = accessory.addService(hap.Service.AccessoryInformation);
    }

    receiverInformationService
      .setCharacteristic(hap.Characteristic.Manufacturer, receiver.manufacturer || 'Naim')
      .setCharacteristic(hap.Characteristic.Model, receiver.modelName || 'Uniti Atom')
      .setCharacteristic(hap.Characteristic.SerialNumber, receiver.serialNumber || 'unknown');

    this.log.debug('Adding atomService');
    accessory.addService(atomService);
    this.log.debug('Finished adding services');

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
  };
}
