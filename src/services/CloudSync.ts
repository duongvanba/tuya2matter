import { Injectable } from "@nestjs/common";
import { TuyaCredential, TuyaDeviceHomeMap, TuyaHass } from "../libs/tuyapi/TuyaHass.js";
import { existsSync } from "fs";
import QrCode from 'qrcode-terminal' 
import { Behavior } from "@matter/main";
import { BehaviorSubject } from "rxjs";


@Injectable()
export class CloudSync extends BehaviorSubject<false | { api: TuyaHass, config: TuyaDeviceHomeMap }> {

    readonly #DIR = './.tuya'
    readonly #CREDENTIAL_PATH = `${this.#DIR}/credential.json`
    readonly #DEVICES_PATH = `${this.#DIR}/devices.json` 
 


    async onModuleInit() {
        const api = await this.#getClient()
        api.credential.subscribe(config => {
            Bun.file(this.#CREDENTIAL_PATH).write(JSON.stringify(config, null, 2))
        })
        if (existsSync(this.#DEVICES_PATH)) {
            const config = await Bun.file(this.#DEVICES_PATH).json() as TuyaDeviceHomeMap
            this.next({ api, config })
        } else {
            const config = await api.fetchAll()
            await Bun.file(this.#DEVICES_PATH).write(JSON.stringify(config, null, 2))
            this.next({ api, config })
        }
    }

    async #getClient() {
        if (existsSync(this.#CREDENTIAL_PATH)) {
            const config = await Bun.file(this.#CREDENTIAL_PATH).json() as TuyaCredential
            return new TuyaHass(config)
        }
        const { next, qrcode } = await TuyaHass.login(process.env.USER_CODE!)
        console.log(`Scan qr code bellow: `)
        QrCode.generate(qrcode, { small: true })
        const hass = await next()
        if (!hass) {
            console.error({ error: 'CAN_NOT_LOGIN' })
            await Bun.sleep(5000)
            process.exit(1)
        }
        return hass

    }


}