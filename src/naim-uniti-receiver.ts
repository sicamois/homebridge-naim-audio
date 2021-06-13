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
} from 'homebridge';
import axios from 'axios';

const PLUGIN_NAME = 'homebridge-naim-uniti-reveiver';
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

  api.registerPlatform(PLATFORM_NAME, NaimUnitiPlatform);
};

type context = {
  ip: string;
};

class NaimUnitiPlatform implements DynamicPlatformPlugin {
  private readonly log: Logging;
  private readonly api: API;
  private readonly config: PlatformConfig;

  private readonly accessories: PlatformAccessory<context>[];

  constructor(log: Logging, config: PlatformConfig, api: API) {
    this.log = log;
    this.api = api;
    this.config = config;
    this.accessories = [];


    // probably parse config or something here

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
      
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    const receivers: { name: string; ip_address:string }[] = this.config.receivers;
    const needsRemoving = !receivers.some(receiver => receiver.name === accessory.displayName && receiver.ip_address === accessory.context.ip);
    if (needsRemoving) {
      this.removeAudioReceiverAccessory(accessory);
    }
  }

  addAudioReceiverAccessory = (name: string, ip: string) => {
    this.log.info('Adding new accessory with name %s', name);

    // uuid must be generated from a unique but not changing data source, name should not be used in the most cases. But works in this specific example.
    const uuid = hap.uuid.generate(name);
    const accessory = new Accessory<context>(
      name,
      uuid,
      hap.Categories.AUDIO_RECEIVER,
    );

    accessory.context = { ip };

    this.setServices(accessory);

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.push(accessory);
  };

  removeAudioReceiverAccessory = (accessory: PlatformAccessory<context>) => {
    this.log.info('Removing accessory with name %s', accessory.displayName);

    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    this.accessories.splice(0, 1, accessory);
  };

  setServices = (accessory: PlatformAccessory<context>) => {
    if (!accessory.context || !accessory.context.ip) {
      this.log.error('No IP Address configured on %s', accessory.displayName);
      return;
    }

    this.log.debug('setServices');
    const baseURL = 'http://' + accessory.context.ip + ':' + NAIM_API_PORT;

    const atomService = new hap.Service.Television(
      accessory.displayName,
      'Naim Unity',
    );
    atomService
      .getCharacteristic(hap.Characteristic.Active)
      .onGet(async () => {
        naimApiGet('/power', 'system')
          .then((returnedValue) => {
            const isActive = returnedValue === 'on';
            atomService.updateCharacteristic(
              hap.Characteristic.Active,
              isActive,
            );
            return isActive;
          })
          .catch((error) => {
            handleError(error);
            return null;
          });
        return null;
      })
      .onSet(async (value) => {
        naimApiPut('/power', 'system', (value as boolean) ? 'on' : 'lona')
          .then((_) => {
            atomService.updateCharacteristic(
              hap.Characteristic.Active,
              value as boolean,
            );
          })
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
            atomService.updateCharacteristic(
              hap.Characteristic.CurrentMediaState,
              mediaState,
            );
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return null;
          });
        // return as soon as possible, update on the resoution of the async function
        return null;
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
            return mediaState;
          })
          .catch((error) => {
            handleError(error);
            return null;
          });
        // return as soon as possible, update on the resoution of the async function
        return null;
      })
      .onSet(async () => {
        naimApiPut('/nowplaying', 'cmd', 'playpause', true).catch((error) => {
          handleError(error);
        });
      });

    const atomSpeakerService = new hap.Service.TelevisionSpeaker(accessory.displayName + 'Service');

    atomSpeakerService
      .getCharacteristic(hap.Characteristic.Mute)
      .onGet(async () => {
        naimApiGet('/levels/room', 'mute')
          .then((returnedValue) => {
            const isMuted = returnedValue === '1';
            atomSpeakerService.updateCharacteristic(
              hap.Characteristic.Mute,
              isMuted,
            );
            return isMuted;
          })
          .catch((error) => {
            handleError(error);
            return null;
          });
        return null;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'mute', value as string).catch((error) => {
          handleError(error);
        });
      });

    atomSpeakerService
      .getCharacteristic(hap.Characteristic.Volume)
      .onGet(async () => {
        naimApiGet('/levels/room', 'volume')
          .then((returnedValue) => {
            if (returnedValue) {
              const volume = parseInt(returnedValue);
              atomSpeakerService.updateCharacteristic(
                hap.Characteristic.Volume,
                volume,
              );
              return volume;
            }
          })
          .catch((error) => {
            handleError(error);
            return null;
          });
        return null;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'volume', value as string).catch((error) => {
          handleError(error);
        });
      });

    const informationService = new hap.Service.AccessoryInformation(accessory.displayName, 'Infos')
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Naim')
      .setCharacteristic(hap.Characteristic.Model, 'Uniti Atom');
    
    this.log.debug('Linking atomSpeakerService');
    atomService.addLinkedService(atomSpeakerService);
    this.log.debug('Adding atomService');
    accessory.addService(atomService);
    this.log.debug('Adding informationService');
    accessory.addService(informationService);
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
