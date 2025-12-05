import { existsSync } from "fs"

export const TUYA_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke'
export const TUYA_SCHEMA = 'haauthorize'
export const DIR = existsSync('/data') ? '/data/tuya' : './.tuya'
export const USER_CODE = process.env.USER_CODE!

export const CREDENTIAL_PATH = `${DIR}/credential.json`
export const DEVICES_PATH = `${DIR}/devices.json`
export const TUYA2MQTT_DEBUG = process.env.TUYA2MQTT_DEBUG  || 'all'