import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';
import axios from 'axios';
import { Client, SsdpHeaders } from 'node-ssdp';
import { Parser } from 'xml2js';
import { RemoteInfo } from 'dgram';

// import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { PLUGIN_NAME } from './settings';
import { NaimAudioAccessory } from './naimAudioAccessory';

export type receiver = {
  name: string;
  ip_address: string;
  manufacturer?: string;
  manufacturerURL?: string;
  modelName?: string;
  modelNumber?: string;
  serialNumber?: string;
  uuid?: string;
};

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class NaimAudioPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly receivers: receiver[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      // run the method to discover / register your devices as accessories
      this.discoverDevices('urn:schemas-upnp-org:device:MediaRenderer:2', 10000);
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent "duplicate UUID" errors.
   */

  private readonly discoverDevices = (
    uPnpType: string,
    durationInMs: number,
  ) => {
    // Find Naim receiver via ssdp
    const ssdp = new Client();
    ssdp.on(
      'response',
      (headers: SsdpHeaders, statusCode: number, remoteInfos: RemoteInfo) => {
        this.extractNaimReceiverFrom(
          headers,
          remoteInfos,
          this.processReceiver,
        );
      });

    this.log.info('Start discovering Naim Audio devices with uPnP');
    try {
      ssdp.search(uPnpType);

      // Force ssdp discovery to stop after 10 secondes
      setTimeout(() => {
        ssdp.stop();
        if (this.receivers.length === 0) {
          this.log.warn('No Naim Audio device found on your network!');
        }
      }, durationInMs);
    } catch (error) {
      this.log.error('An error occured during discovering : %s', error.message);
    }
  };

  private readonly extractNaimReceiverFrom = async (
    headers: SsdpHeaders,
    remoteInfos: RemoteInfo,
    andProcessTheReceiver: (receiver: receiver) => void,
  ) => {
    const xmlParser = new Parser();

    const response = await axios({
      responseType: 'text',
      url: headers.LOCATION,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    xmlParser.parseString(response.data, (error: any, result: any) => {
      if (error === null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const device: any = result.root.device[0];
        this.log.debug('New device found !\n   name: %s\n   manufacturer: %s\n   model: %s\n   IP Address: %s\n   uPnp type: %s',
          device.friendlyName[0],
          device.manufacturer[0],
          device.modelName[0],
          remoteInfos.address,
          device.deviceType[0],
        );
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
            if (this.receivers.find(existingReceiver => existingReceiver.name === receiver.name)) {
              this.log.info(
                '%s discovered ! Already configured -> skipping',
                receiver.name,
              );
              return;
            }

            this.log.info(
              '%s discovered ! It is a %s %s',
              receiver.name,
              receiver.manufacturer,
              receiver.modelName,
            );
            this.receivers.push(receiver);
            andProcessTheReceiver(receiver);
          }
        } else {
          this.log.error('Unable to parse response from SSDP : %s', error);
        }
      }
    });
  };

  private readonly processReceiver = (receiver: receiver) => {
    const receiverName = receiver.name;
    const speakerName = receiver.name + 'Speaker';

    const receiverUuid = this.api.hap.uuid.generate(receiverName);
    const speakerUuid = this.api.hap.uuid.generate(speakerName);

    // see if an accessory with the same uuid has already been registered and restored from
    // the cached devices we stored in the `configureAccessory` method above
    const existingReceiverAccessory = this.accessories.find((accessory) => accessory.UUID === receiverUuid);
    const existingSpeakerAccessory = this.accessories.find((accessory) => accessory.UUID === speakerUuid);

    if (existingReceiverAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingReceiverAccessory.displayName);

      // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
      // existingAccessory.context.device = device;
      // this.api.updatePlatformAccessories([existingAccessory]);

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      new NaimAudioAccessory(this, existingReceiverAccessory);

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // remove platform accessories when no longer present
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);
    } else if (existingSpeakerAccessory) {
      // the accessory already exists
      this.log.info('Restoring existing accessory from cache:', existingSpeakerAccessory.displayName);

      // if you need to update the accessory.context then you should run `api.updatePlatformAccessories`. eg.:
      // existingAccessory.context.device = device;
      // this.api.updatePlatformAccessories([existingAccessory]);

      // create the accessory handler for the restored accessory
      // this is imported from `platformAccessory.ts`
      new NaimAudioAccessory(this, existingSpeakerAccessory);

      // it is possible to remove platform accessories at any time using `api.unregisterPlatformAccessories`, eg.:
      // remove platform accessories when no longer present
      // this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [existingAccessory]);
      // this.log.info('Removing existing accessory from cache:', existingAccessory.displayName);

    } else {
      // the accessory does not yet exist, so we need to create it
      this.log.info('Adding new accessories: %s and %s', receiverName, speakerName);

      // create two new accessories : Receiver and Speaker
      const receiverAccessory = new this.api.platformAccessory(
        receiverName,
        receiverUuid,
        this.api.hap.Categories.AUDIO_RECEIVER,
      );
      const speakerAccessory = new this.api.platformAccessory(
        speakerName,
        speakerUuid,
        this.api.hap.Categories.SPEAKER,
      );

      // store a copy of the device object in the `accessory.context`
      // the `context` property can be used to store any data about the accessory you may need
      receiverAccessory.context.receiver = receiver;
      speakerAccessory.context.receiver = receiver;

      // create the accessory handler for the newly create accessory
      // this is imported from `platformAccessory.ts`
      new NaimAudioAccessory(this, receiverAccessory);

      // link the accessory to your platform as External accessory if a TV Service is in the accessory
      // if (accessory.getService(this.Service.Television)) {
      //   this.api.publishExternalAccessories(PLUGIN_NAME, [accessory]);
      // } else {
      //   this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      // }
      this.api.publishExternalAccessories(PLUGIN_NAME, [receiverAccessory, speakerAccessory]);

    }
  };

}
