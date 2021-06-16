import { Service, PlatformAccessory, CharacteristicValue } from 'homebridge';
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
  private infoService: Service;
  private tvService: Service;
  private smartSpeakerService: Service;
  private speakerService: Service;
  private coreServices: Service[];
  private inputs: input[];
  private baseURL: string;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private receiverStates = {
    powerOn: false,
    currentMediaState: this.platform.Characteristic.CurrentMediaState.STOP,
    mute: false,
    volume: 0,
  };

  constructor(
    private readonly platform: NaimAudioPlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    const receiver: receiver = accessory.context.receiver;
    this.baseURL = 'http://' + receiver.ip_address + ':' + NAIM_API_PORT;
    this.inputs = [];

    // set accessory information
    this.infoService = this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, receiver.manufacturer || 'Naim Audio')
      .setCharacteristic(this.platform.Characteristic.Model, receiver.modelName || 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, receiver.serialNumber || 'Default-Serial');

    // get the Television service if it exists, otherwise create a new Television service
    // you can create multiple services for each accessory
    this.tvService =
      this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television);

    // set the service name, this is what is displayed as the default name on the Home app
    // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    this.tvService.setCharacteristic(this.platform.Characteristic.Name, this.accessory.context.receiver.name);
    this.tvService.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.accessory.context.receiver.name);

    // each service must implement at-minimum the "required characteristics" for the given service type

    // register handlers for the On/Off Characteristic
    this.tvService.getCharacteristic(this.platform.Characteristic.Active)
      .onSet(this.setActive.bind(this))
      .onGet(this.getActive.bind(this));

    // add a smart speaker service to handle play/pause

    // const speakerName = this.accessory.context.receiver.name + ' Speakers';
    // // eslint-disable-next-line brace-style
    // const speakerService = this.tvService.linkedServices.find(service => { service instanceof this.platform.Service.SmartSpeaker; });
    // if (speakerService) {
    //   this.smartSpeakerService = speakerService;
    // } else {
    //   this.smartSpeakerService = new this.platform.api.hap.Service(speakerName, this.platform.api.hap.uuid.generate(speakerName));
    //   this.tvService.addLinkedService(this.smartSpeakerService);
    // }
    this.smartSpeakerService =
      this.accessory.getService(this.platform.Service.SmartSpeaker) ||
      this.accessory.addService(this.platform.Service.SmartSpeaker);

    this.smartSpeakerService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.receiver.name);
    this.smartSpeakerService.setCharacteristic(this.platform.Characteristic.ConfiguredName, accessory.context.receiver.name);

    this.smartSpeakerService.getCharacteristic(this.platform.Characteristic.CurrentMediaState)
      .onGet(this.getCurrentMediaState.bind(this));

    this.smartSpeakerService.getCharacteristic(this.platform.Characteristic.TargetMediaState)
      .onSet(this.setTargetMediaState.bind(this))
      .onGet(this.getCurrentMediaState.bind(this));

    // add a speaker service to handle volume and mute
    this.speakerService =
      this.accessory.getService(this.platform.Service.TelevisionSpeaker) ||
      this.accessory.addService(this.platform.Service.TelevisionSpeaker);

    this.speakerService.getCharacteristic(this.platform.Characteristic.Mute)
      .onSet(this.setMute.bind(this))
      .onGet(this.getMute.bind(this));

    this.tvService.addLinkedService(this.speakerService);

    // this.speakerService.getCharacteristic(this.platform.Characteristic.Volume)
    //   .onSet(this.setVolume.bind(this))
    //   .onGet(this.getVolume.bind(this));

    // Define Core Services = all services except Inputs
    this.coreServices = [this.infoService, this.tvService, this.smartSpeakerService, this.speakerService];

    this.getInputs();
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
        this.platform.Service.InputSource,
        input.name,
        this.platform.api.hap.uuid.generate(input.name),
      );
      const inputSourceType = this.getSourceTypeFrom(input.canonicalName);

      inputService
        .setCharacteristic(this.platform.Characteristic.Identifier, inputs.indexOf(input))
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, input.name)
        .setCharacteristic(this.platform.Characteristic.IsConfigured, this.platform.Characteristic.IsConfigured.CONFIGURED)
        .setCharacteristic(this.platform.Characteristic.InputSourceType, inputSourceType);

      this.tvService.addLinkedService(inputService);
      this.platform.log.debug('Input: %s added to %s', input.name, accessory.displayName);
    });
  };

  private getSourceTypeFrom = (name: string): number => {
    switch (name) {
      case 'HDMI':
        return this.platform.Characteristic.InputSourceType.HDMI;
      case 'Internet Radio':
        return this.platform.Characteristic.InputSourceType.TUNER;
      case 'Airplay':
      case 'Chromecast built-in':
        return this.platform.Characteristic.InputSourceType.AIRPLAY;
      case 'USB':
        return this.platform.Characteristic.InputSourceType.USB;
      case 'Spotify':
      case 'TIDAL':
      case 'Qobuz':
        return this.platform.Characteristic.InputSourceType.APPLICATION;
      default:
        return this.platform.Characteristic.InputSourceType.OTHER;
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
      });
  };

  private getActive = async (): Promise<CharacteristicValue> => {
    let isActive = this.receiverStates.powerOn;
    this.naimApiGet('/power', 'system')
      .then((returnedValue) => {
        isActive = returnedValue === 'on';
        this.receiverStates.powerOn = isActive;
        this.tvService.updateCharacteristic(this.platform.Characteristic.Active, isActive);
      })
      .catch((error) => {
        this.handleError(error);
        this.receiverStates.powerOn = false;
        this.tvService.updateCharacteristic(this.platform.Characteristic.Active, false);
      });
    return isActive;
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
    this.smartSpeakerService.updateCharacteristic(
      this.platform.Characteristic.CurrentMediaState,
      this.receiverStates.currentMediaState,
    );
  };

  private getCurrentMediaState = async () => {
    let mediaState = this.receiverStates.currentMediaState;
    this.naimApiGet('/nowplaying', 'transportState')
      .then((returnedValue) => {
        switch (returnedValue?.toString()) {
          case '2':
            mediaState = this.platform.Characteristic.CurrentMediaState.PLAY;
            break;
          case '1':
          case '3':
            mediaState = this.platform.Characteristic.CurrentMediaState.PAUSE;
            break;
          default:
            mediaState = this.platform.Characteristic.CurrentMediaState.STOP;
            break;
        }
        this.receiverStates.currentMediaState = mediaState;
        this.smartSpeakerService.updateCharacteristic(
          this.platform.Characteristic.CurrentMediaState,
          mediaState,
        );
        this.tvService.getCharacteristic(this.platform.Characteristic.Active);
      })
      .catch((error) => {
        this.handleError(error);
        this.smartSpeakerService.updateCharacteristic(
          this.platform.Characteristic.CurrentMediaState,
          mediaState,
        );
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
        this.speakerService.getCharacteristic(this.platform.Characteristic.Mute);
      })
      .catch(
        (error) => {
          this.handleError(error);
          this.receiverStates.mute = !isMuted;
          this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, !isMuted);
        });
    this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, isMuted);
  };

  private getMute = async () => {
    let isMuted = this.receiverStates.mute;
    this.naimApiGet('/levels/room', 'mute')
      .then((returnedValue) => {
        isMuted = returnedValue === '1';
        this.receiverStates.mute = isMuted;
        this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, isMuted);
      })
      .catch((error) => {
        this.handleError(error);
        this.receiverStates.mute = false;
        this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, false);
      });
    return isMuted;
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

  private getVolume = async () => {
    let volume = this.receiverStates.volume;
    this.naimApiGet('/levels/room', 'volume')
      .then((returnedValue) => {
        returnedValue = returnedValue|| '';
        volume = +returnedValue;
        this.receiverStates.volume = volume;
        this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, volume);
      })
      .catch((error) => {
        this.handleError(error);
        this.speakerService.updateCharacteristic(this.platform.Characteristic.Mute, volume);
      });
    return volume;
  };


  // Utility functions
  private naimApiGet = async (path: string, key: string) => {
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
