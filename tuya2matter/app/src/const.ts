import { existsSync } from "fs"

export const TUYA_CLIENT_ID = 'HA_3y9q4ak7g4ephrvke'
export const TUYA_SCHEMA = 'haauthorize'
export const DIR = existsSync('/data') ? '/data/tuya' : './.tuya'
export const USER_CODE = process.env.USER_CODE!