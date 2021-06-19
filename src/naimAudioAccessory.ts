import { Service, PlatformAccessory, CharacteristicValue, Categories, Characteristic } from 'homebridge';
import axios from 'axios';

import { NaimAudioPlatform, receiver } from './naimAudioPlatform';

const NAIM_API_PORT = 15081;

type input = {
  name: string;
  canonicalName: string;
  path: string;
};

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class NaimAudioAccessory {
  public readonly Service: typeof Service = this.platform.Service;
  public readonly Characteristic: typeof Characteristic = this.platform.Characteristic;
  private infoService: Service;
  private service?: Service;
  private coreServices: Service[];
  private inputs: input[];
  private baseURL: string;
  private volumeIncrement: number;
  private category: Categories;
  private name: string;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private receiverStates = {
    powerOn: false,
    currentMediaState: this.Characteristic.CurrentMediaState.STOP,
    mute: false,
    volume: 0,
    currentInput: 0,
  };

  constructor(
    private readonly platform: NaimAudioPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    const receiver: receiver = accessory.context.receiver;
    this.baseURL = 'http://' + receiver.ip_address + ':' + NAIM_API_PORT;
    this.inputs = [];
    this.volumeIncrement = 1;
    this.coreServices = [];
    this.category = accessory.category;
    this.name = accessory.displayName;

    // set accessory information
    this.infoService =
      this.accessory.getService(this.Service.AccessoryInformation) ||
      this.accessory.addService(this.Service.AccessoryInformation);

    this.infoService
      .setCharacteristic(this.Characteristic.Manufacturer, receiver.manufacturer || 'Naim Audio')
      .setCharacteristic(this.Characteristic.Model, receiver.modelName || 'Default-Model')
      .setCharacteristic(this.Characteristic.SerialNumber, receiver.serialNumber || 'Default-Serial');

    this.coreServices.push(this.infoService);

    if (this.category === Categories.AUDIO_RECEIVER) {

      // get the Television service if it exists, otherwise create a new Television service
      // you can create multiple services for each accessory
      this.service =
        this.accessory.getService(this.Service.Television) ||
        this.accessory.addService(this.Service.Television);

      // Define Core Services = all services except Inputs
      this.coreServices.push(this.service);

      // set the service name, this is what is displayed as the default name on the Home app
      // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
      this.service!.setCharacteristic(this.Characteristic.Name, this.accessory.context.receiver.name);
      this.service!.setCharacteristic(this.Characteristic.ConfiguredName, this.accessory.context.receiver.name);


      this.service!.setCharacteristic(
        this.Characteristic.SleepDiscoveryMode,
        this.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

      // each service must implement at-minimum the "required characteristics" for the given service type

      // register handlers for the On/Off Characteristic
      this.service!.getCharacteristic(this.Characteristic.Active)
        .onSet(this.setActive.bind(this))
        .onGet(this.getActive.bind(this));


      this.service
        .getCharacteristic(this.Characteristic.ActiveIdentifier)
        .onSet(this.setInputSource.bind(this))
        .onGet(this.getInputSource.bind(this));

      this.getInputs();

    } else if (this.category === Categories.SPEAKER) {
      this.platform.log.warn('I found an HOMEPOD !!!');
      // add a smart speaker service to handle volume and mute
      this.service =
        this.accessory.getService(this.Service.Speaker) ||
        this.accessory.addService(this.Service.Speaker);

      // Define Core Services = all services except Inputs
      this.coreServices.push(this.service);

      // this.service!.getCharacteristic(this.Characteristic.CurrentMediaState)
      //   .onGet(this.getCurrentMediaState.bind(this));

      // this.service!.getCharacteristic(this.Characteristic.TargetMediaState)
      //   .onSet(this.setTargetMediaState.bind(this))
      //   .onGet(this.getCurrentMediaState.bind(this));

      // set the service name, this is what is displayed as the default name on the Home app
      // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
      this.service!.setCharacteristic(this.Characteristic.Name, this.accessory.context.receiver.name);
      this.service!.setCharacteristic(this.Characteristic.ConfiguredName, this.accessory.context.receiver.name);

      this.service!.getCharacteristic(this.Characteristic.Mute)
        .onSet(this.setMute.bind(this))
        .onGet(this.getMute.bind(this));

      this.service!.getCharacteristic(this.Characteristic.Volume)
        .onSet(this.setVolume.bind(this))
        .onGet(this.getVolume.bind(this));

      // register handlers for the On/Off Characteristic
      this.service!.addCharacteristic(this.Characteristic.Active)
        .onSet(this.setActive.bind(this))
        .onGet(this.getActive.bind(this));
    }
  }

  private getInputs = async () => {
    this.naimApiGet('/inputs', 'children')
      .then((inputsData) => {
        if (inputsData) {
          // eslint-disable-next-line @typescript-eslint/member-delimiter-style
          inputsData.forEach((inputFound: { disabled: string; selectable: string; alias: string; name: string; ussi: string;} ) => {
            if ((!inputFound.disabled || inputFound.disabled === '0') && inputFound.selectable === '1') {
              // rename "Playqueue" to "Playlist"
              const correctedInputName = inputFound.name === 'Playqueue' ? 'Playlist' : inputFound.name;
              const input: input = {
                name: inputFound.alias || correctedInputName,
                canonicalName: inputFound.name,
                path: inputFound.ussi,
              };
              this.inputs.push(input);
            }
          });

          // We have the list of inputs in this.inputs array
          if (this.inputs.length > 0) {
            this.addInputsToAccessory(this.inputs, this.accessory);
          }

          // Clean old inputs
          this.removeInputServicesNotIn(this.inputs, this.accessory, this.coreServices);
        }
      });
  };

  private addInputsToAccessory = (inputs: input[], accessory: PlatformAccessory) => {
    inputs.forEach(input => {
      const inputService = this.accessory.getService(input.name) || this.accessory.addService(
        this.Service.InputSource,
        input.name,
        this.platform.api.hap.uuid.generate(input.name),
      );
      const inputSourceType = this.getSourceTypeFrom(input.canonicalName);

      inputService
        .setCharacteristic(this.Characteristic.Identifier, inputs.indexOf(input))
        .setCharacteristic(this.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(this.Characteristic.IsConfigured, this.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.Characteristic.InputSourceType, inputSourceType);

      this.service!.addLinkedService(inputService);
      this.platform.log.debug('Input: %s added to %s', input.name, accessory.displayName);
    });
  };

  private getSourceTypeFrom = (name: string): number => {
    switch (name) {
      case 'HDMI':
        return this.Characteristic.InputSourceType.HDMI;
      case 'Internet Radio':
        return this.Characteristic.InputSourceType.TUNER;
      case 'Airplay':
      case 'Chromecast built-in':
        return this.Characteristic.InputSourceType.AIRPLAY;
      case 'USB':
        return this.Characteristic.InputSourceType.USB;
      case 'Spotify':
      case 'TIDAL':
      case 'Qobuz':
        return this.Characteristic.InputSourceType.APPLICATION;
      default:
        return this.Characteristic.InputSourceType.OTHER;
    }
  };

  private removeInputServicesNotIn = (inputs: input[], fromAccessory: PlatformAccessory, excludingNonInputServices: Service[]) => {
    const inputNames = inputs.map(input => input.name);

    const services = fromAccessory.services;
    const inputServices = services.filter(service => !excludingNonInputServices.includes(service));

    const inputServicesToRemove = inputServices.filter(inputService => !inputNames.includes(inputService.displayName));

    inputServicesToRemove.forEach(service => {
      this.accessory.removeService(service);
      this.platform.log.debug('Input: %s removed from %s', service.displayName, fromAccessory.displayName);
    });
  };

  private setActive = async (value: CharacteristicValue) => {
    const isActive = value as boolean;
    this.receiverStates.powerOn = isActive;
    this.naimApiPut('/power', 'system', isActive ? 'on' : 'lona').catch(
      (error) => {
        this.handleError(error);
        this.receiverStates.powerOn = false;
        this.service!.getCharacteristic(this.Characteristic.ActiveIdentifier);
      });
  };

  private getActive = async (): Promise<CharacteristicValue> => {
    let isActive = this.receiverStates.powerOn;
    this.naimApiGet('/power', 'system')
      .then((returnedValue) => {
        isActive = returnedValue === 'on';
        this.receiverStates.powerOn = isActive;
        this.service!.updateCharacteristic(this.Characteristic.Active, isActive);
      })
      .catch((error) => {
        this.handleError(error);
        this.receiverStates.powerOn = false;
        this.service!.updateCharacteristic(this.Characteristic.Active, false);
      });
    return isActive;
  };

  private setInputSource = async (value: CharacteristicValue) => {
    const inputIndex = +value;
    this.receiverStates.currentInput = inputIndex;
    const pathToSet = this.inputs[inputIndex].path;
    this.naimApiPut(pathToSet, 'cmd', 'select', true)
      .catch(error => {
        this.handleError(error);
        this.service!.getCharacteristic(this.Characteristic.ActiveIdentifier);
      });
  };

  private getInputSource = async (): Promise<CharacteristicValue> => {
    const sourcePath = await this.naimApiGet('/nowplaying', 'source');
    if (sourcePath) {
      const inputPathes = this.inputs.map(input => input.path);
      const sourceIndex = inputPathes.indexOf(sourcePath);
      this.receiverStates.currentInput = sourceIndex;
      this.service!.updateCharacteristic(this.Characteristic.ActiveIdentifier, sourceIndex);
      return sourceIndex;
    }
    return 0;
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private setTargetMediaState = async (_: CharacteristicValue) => {
    if (this.receiverStates.currentMediaState === 0) {
      this.receiverStates.currentMediaState = 1;
    } else {
      this.receiverStates.currentMediaState = 0;
    }
    this.naimApiPut('/nowplaying', 'cmd', 'playpause', true)
      .catch((error) => {
        this.handleError(error);
        this.receiverStates.currentMediaState === 0 ? 1 : 0;
      });
    this.service!.updateCharacteristic(
      this.Characteristic.CurrentMediaState,
      this.receiverStates.currentMediaState,
    );
  };

  private getCurrentMediaState = async (): Promise<CharacteristicValue> => {
    let mediaState = this.receiverStates.currentMediaState;
    this.naimApiGet('/nowplaying', 'transportState')
      .then((returnedValue) => {
        switch (returnedValue?.toString()) {
          case '2':
            mediaState = this.Characteristic.CurrentMediaState.PLAY;
            break;
          case '1':
          case '3':
            mediaState = this.Characteristic.CurrentMediaState.PAUSE;
            break;
          default:
            mediaState = this.Characteristic.CurrentMediaState.STOP;
            break;
        }
        this.receiverStates.currentMediaState = mediaState;
        this.service!.updateCharacteristic(this.Characteristic.CurrentMediaState, mediaState);
        this.service!.getCharacteristic(this.Characteristic.Active);
      })
      .catch((error) => {
        this.handleError(error);
        this.service!.updateCharacteristic(this.Characteristic.CurrentMediaState, mediaState);
      });
    // return as soon as possible, update on the resoution of the async function
    return mediaState;
  };

  private setMute = async (value: CharacteristicValue) => {
    this.platform.log.debug('setMute with value : %s', value);
    const isMuted = value as boolean;
    this.receiverStates.mute = isMuted;
    this.naimApiPut('/levels/room', 'mute', value as string)
      .then( () => {
        this.service!.getCharacteristic(this.Characteristic.Mute);
      })
      .catch(
        (error) => {
          this.handleError(error);
          this.receiverStates.mute = !isMuted;
          this.service!.updateCharacteristic(this.Characteristic.Mute, !isMuted);
        });
    this.service!.updateCharacteristic(this.Characteristic.Mute, isMuted);
  };

  private getMute = async (): Promise<CharacteristicValue> => {
    let isMuted = this.receiverStates.mute;
    this.naimApiGet('/levels/room', 'mute')
      .then((returnedValue) => {
        isMuted = returnedValue === '1';
        this.receiverStates.mute = isMuted;
        this.service!.updateCharacteristic(this.Characteristic.Mute, isMuted);
      })
      .catch((error) => {
        this.handleError(error);
        this.receiverStates.mute = false;
        this.service!.updateCharacteristic(this.Characteristic.Mute, false);
      });
    return isMuted;
  };

  private setVolumeRelative = async (value: CharacteristicValue) => {
    let volume = this.receiverStates.volume;
    if (value === this.Characteristic.VolumeSelector.INCREMENT) {
      volume = volume + this.volumeIncrement;
      this.receiverStates.volume = volume;
      this.naimApiPut('/levels/room', 'volume', volume.toString())
        .catch(
          (error) => {
            this.handleError(error);
            this.receiverStates.volume = volume - this.volumeIncrement;
          });
    }
    if (value === this.Characteristic.VolumeSelector.DECREMENT) {
      volume = volume - this.volumeIncrement;
      this.receiverStates.volume = volume;
      this.naimApiPut('/levels/room', 'volume', volume.toString())
        .catch(
          (error) => {
            this.handleError(error);
            this.receiverStates.volume = volume + this.volumeIncrement;
          });
    }
    this.service!.updateCharacteristic(this.Characteristic.Volume, volume);
  };

  private setVolume = async (value: CharacteristicValue) => {
    const initVolume = this.receiverStates.volume;
    const volume = +value;
    this.receiverStates.volume = volume;
    this.naimApiPut('/levels/room', 'volume', volume.toString())
      .catch(
        (error) => {
          this.handleError(error);
          this.receiverStates.volume = initVolume;
        });
  };

  private getVolume = async (): Promise<CharacteristicValue> => {
    let volume = this.receiverStates.volume;
    this.naimApiGet('/levels/room', 'volume')
      .then((returnedValue) => {
        returnedValue = returnedValue|| '';
        volume = +returnedValue;
        this.receiverStates.volume = volume;
        this.service!.updateCharacteristic(this.Characteristic.Mute, volume);
      })
      .catch((error) => {
        this.handleError(error);
        this.service!.updateCharacteristic(this.Characteristic.Mute, volume);
      });
    return volume;
  };


  // Utility functions
  private naimApiGet = async (path: string, key: string) => {
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    const apiURL = this.baseURL + path;
    this.platform.log.debug('naimApiCall - GET : ' + key + '@' + apiURL);
    try {
      const response = await axios.get(apiURL);
      return response.data[key];
    } catch (error) {
      this.handleError(error, apiURL);
    }
  };

  private naimApiPut = async (
    path: string,
    key: string,
    valueToSet: string,
    forceGet = false,
  ) => {
    if (!path.startsWith('/')) {
      path = '/' + path;
    }
    const apiURL = this.baseURL + path + '?' + key + '=' + valueToSet;
    this.platform.log.debug(
      'naimApiCall - PUT ' +
        (forceGet ? '(forced)' : '') + ' : ' + valueToSet + ' into ' + key + '@' + apiURL);
    if (!forceGet) {
      axios.put(apiURL).catch((error) => {
        this.handleError(error, apiURL);
      });
    } else {
      axios.get(apiURL).catch((error) => {
        this.handleError(error, apiURL);
      });
    }
  };

  private handleError = (error: Error, url = 'N/A') => {
    if (axios.isAxiosError(error)) {
      if (error.response) {
        // client received an error response (5xx, 4xx)
        this.platform.log.error(
          'Naim receiver emited a bad response (On : %s - Details : %s)',
          url,
          error.message,
        );
      } else if (error.request) {
        // client never received a response, or request never left
        this.platform.log.error(
          'Naim receiver did not respond. Check the IP Address in your configuration of the plugin. (On : %s - Details : %s)',
          url,
          error.message,
        );
      } else {
        // Not a network error
        this.platform.log.error(
          'Other request error (On : %s - Details : %s)',
          url,
          error.message,
        );
      }
    } else {
      // Not an error from the request
      this.platform.log.error('Problem (On : %s - Details : %s)', url, error.message);
    }
  };
}
