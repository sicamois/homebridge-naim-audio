import {
  AccessoryPlugin,
  Categories,
  CharacteristicGetCallback,
  CharacteristicSetCallback,
  CharacteristicValue,
  HAP,
  Logging,
  Service,
  CharacteristicEventTypes,
  Characteristic,
} from 'homebridge';

import axios from 'axios';
import { HomebridgeAPI } from 'homebridge/lib/api';

const NAIM_API_PORT = 15081;

export class NaimUnitiReceiver implements AccessoryPlugin {
  public name: string;
  public category: Categories;

  private readonly log: Logging;

  private readonly atomService: Service;
  private readonly atomSpeakerService: Service;
  private readonly informationService: Service;

  private powerOn: boolean;
  private mute: boolean;
  private volume: number;
  private currentMediaState: number;

  constructor(hap: HAP, log: Logging, name: string, ip: string) {
    log.debug('Creating atom');
    this.log = log;
    this.name = name;
    this.powerOn = false;
    this.mute = false;
    this.volume = 0;
    this.currentMediaState = hap.Characteristic.CurrentMediaState.STOP;
    this.category = hap.Categories.AUDIO_RECEIVER;

    const baseURL = 'http://' + ip + ':' + NAIM_API_PORT;

    this.atomService = new hap.Service.Television(name, 'Naim Unity');
    this.atomService
      .getCharacteristic(hap.Characteristic.Active)
      .onGet(async () => {
        naimApiGet('/power', 'system')
          .then( (returnedValue) => {
            this.powerOn = returnedValue === 'on';
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomService.updateCharacteristic(hap.Characteristic.Active, this.powerOn);
          });
        // return a guess (power toggled) as soon as possible. Update when the async finction returns
        return this.powerOn;
      })
      .onSet(async (value) => {
        naimApiPut('/power', 'system', (value as boolean) ? 'on' : 'lona')
          .then(_ => {
            this.powerOn = value as boolean;
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomService.updateCharacteristic(hap.Characteristic.Active, this.powerOn);
          });
      });

    this.atomService.setCharacteristic(hap.Characteristic.ActiveIdentifier, 1);
    this.atomService.setCharacteristic(
      hap.Characteristic.ConfiguredName,
      this.name);

    this.atomService
      .getCharacteristic(hap.Characteristic.CurrentMediaState)
      .onGet(async () => {
        let mediaState: number;
        naimApiGet('/nowplaying', 'transportState')
          .then(returnedValue => {
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
            this.currentMediaState = mediaState;
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomService.updateCharacteristic(hap.Characteristic.CurrentMediaState, this.currentMediaState);
          });
        // return as soon as possible, update on the resoution of the async function
        return this.currentMediaState;
      });

    this.atomService
      .getCharacteristic(hap.Characteristic.TargetMediaState)
      .onGet(async () => {
        let mediaState: number;
        naimApiGet('/nowplaying', 'transportState')
          .then(returnedValue => {
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
            this.currentMediaState = mediaState;
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomService.updateCharacteristic(hap.Characteristic.CurrentMediaState, this.currentMediaState);
          });
        return this.currentMediaState;
      })
      .onSet(async () => {
        naimApiPut('/nowplaying', 'cmd', 'playpause', true)
          .then(_ => {
            if (
              this.currentMediaState === hap.Characteristic.CurrentMediaState.PAUSE
            ) {
              this.currentMediaState = hap.Characteristic.CurrentMediaState.PLAY;
            } else {
              this.currentMediaState = hap.Characteristic.CurrentMediaState.PAUSE;
            }
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomService.updateCharacteristic(hap.Characteristic.CurrentMediaState, this.currentMediaState);
          });
      });

    this.atomSpeakerService = new hap.Service.TelevisionSpeaker(this.name + 'Speaker');

    this.atomSpeakerService
      .getCharacteristic(hap.Characteristic.Mute)
      .onGet(async () => {
        naimApiGet('/levels/room', 'mute')
          .then(returnedValue => {
            this.mute = returnedValue === '1';
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomSpeakerService.updateCharacteristic(hap.Characteristic.Mute, this.mute);
          });
        return this.mute;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'mute', value as string)
          .then(_ => {
            this.mute = value === '1';
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomSpeakerService.updateCharacteristic(hap.Characteristic.Mute, this.mute);
          });
      });

    this.atomSpeakerService
      .getCharacteristic(hap.Characteristic.Volume)
      .onGet(async () => {
        naimApiGet('/levels/room', 'volume')
          .then(returnedValue => {
            if (returnedValue) {
              this.volume = parseInt(returnedValue);
            }
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomSpeakerService.updateCharacteristic(hap.Characteristic.Volume, this.volume);
          });
        return this.volume;
      })
      .onSet(async (value) => {
        naimApiPut('/levels/room', 'volume', value as string)
          .then( () => {
            this.volume = value as number;
          })
          .catch(error => {
            handleError(error);
          })
          .finally( () => {
            this.atomSpeakerService.updateCharacteristic(hap.Characteristic.Volume, this.volume);
          });
      });

    const naimApiGet = async (path: string, key: string) => {
      const apiURL = baseURL + path;
      log.debug('naimApiCall - GET : ' + key + '@' + apiURL);
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
      forceGet = false) => {
      const apiURL = baseURL + path + '?' + key + '=' + valueToSet;
      log.debug('naimApiCall - PUT ' + (forceGet ? '(forced)' : '') + ' : ' + valueToSet + ' into ' + key + '@' + apiURL);
      if (!forceGet) {
        axios.put(apiURL)
          .catch(error => {
            handleError(error, apiURL);
          });
      } else {
        axios.get(apiURL)
          .catch(error => {
            handleError(error, apiURL);
          });
      }
    };

    function handleError(error: Error, url = 'N/A') {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          // client received an error response (5xx, 4xx)
          log.error('Naim receiver emited a bad response (On : %s - Details : %s)', url, error.message);
        } else if (error.request) {
          // client never received a response, or request never left
          log.error('Naim receiver did not respond. Check the IP Address in your configuration of the plugin. (On : %s - Details : %s)', url, error.message);
        } else {
          // Not a network error
          log.error('Other request error (On : %s - Details : %s)', url, error.message);
        }
      } else {
        // Not an error from the request
        log.error('Problem (On : %s - Details : %s)', url, error.message);
      }
    }

    naimApiGet('system', 'hardwareSerial')
      .then(returnedValue => {
        if (returnedValue) {
          this.informationService.updateCharacteristic(hap.Characteristic.SerialNumber, returnedValue);
        }
      });

    this.informationService = new hap.Service.AccessoryInformation()
      .setCharacteristic(hap.Characteristic.Manufacturer, 'Naim')
      .setCharacteristic(hap.Characteristic.Model, 'Uniti Atom');

    log.info('Naim Uniti Receiver %s created!', name);
  }

  /*
   * This method is optional to implement. It is called when HomeKit ask to identify the accessory.
   * Typical this only ever happens at the pairing process.
   */
  identify(): void {
    this.log('Identify!');
  }

  /*
   * This method is called directly after creation of this instance.
   * It should return all services which should be added to the accessory.
   */
  getServices(): Service[] {
    return [this.informationService, this.atomService, this.atomSpeakerService];
  }
}
