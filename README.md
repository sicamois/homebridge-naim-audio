<p align="center">

<img src="https://upload.wikimedia.org/wikipedia/commons/c/ca/Naim_Audio_Logo_Black.jpg" width="150">

</p>


# Homebridge Naim Audio

This plugin integrates the Naim Audio devices into Apple Home App.

## Features

Power the amplifier On and Off
Auto-discover all your connected Naim Audio devices

## Configuration

### Using Homebridge web interface (Config UI X)

In the Plugin page, click on "Settings" and then simply save. As easy as that !

### Manual

Your config.json file must include the following for the plugin to be active.

```json
"platforms": [
  {
    "platform": "NaimAudioPlatform",
    "name": "Naim Adio"
  }
]
```
