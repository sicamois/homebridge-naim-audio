<p align="center">

<img src="https://upload.wikimedia.org/wikipedia/commons/c/ca/Naim_Audio_Logo_Black.jpg" width="150">

</p>


# Homebridge Naim Audio
[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm](https://img.shields.io/npm/v/homebridge-naim-audio.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-naim-audio)
[![npm](https://img.shields.io/npm/dt/homebridge-naim-audio.svg?style=flat-square)](https://www.npmjs.com/package/homebridge-naim-audio)
[![GitHub last commit](https://img.shields.io/github/last-commit/sicamois/homebridge-naim-audio.svg?style=flat-square)](https://github.com/SeydX/homebridge-bravia-tvos)

This plugin integrates the Naim Audio devices into Apple Home App.

## Features

- Power the amplifier On and Off
- Auto-discover all your connected Naim Audio devices

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

## Credits

This plugin uses third-aprties libraries :
- [axios](https://github.com/axios/axios) developed by [axios](https://axios-http.com)
- [node-ssdp](https://github.com/diversario/node-ssdp) developed by Ilya Shaisultanov ([diversario](https://github.com/diversario))
- [node-xml2js](https://github.com/Leonidas-from-XIV/node-xml2js) developed by Marek Kubica ([Leonidas-from-XIV](https://github.com/Leonidas-from-XIV))
