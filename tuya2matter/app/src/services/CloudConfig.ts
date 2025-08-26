import { Injectable } from "@nestjs/common";
import { TuyaCredential, TuyaDeviceHomeMap, TuyaCloud } from "../libs/tuyapi/TuyaCloud.js";
import { existsSync } from "fs";
import QrCode from 'qrcode-terminal'
import { BehaviorSubject } from "rxjs";


@Injectable()
export class CloudConfig extends BehaviorSubject<false | { api: TuyaCloud, config: TuyaDeviceHomeMap }> {

    readonly #DIR = existsSync('/data') ? '/data/tuya' : './.tuya'
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
            return new TuyaCloud(config)
        }
        const { next, qrcode } = await TuyaCloud.login(process.env.USER_CODE!)
        console.log(`Use Tuya app to scan this bellow qr code:\n\n`)
        console.log(`QRcode URL: https://api.qrserver.com/v1/create-qr-code/?size=450x450&data=${encodeURIComponent(qrcode)}`)
        QrCode.generate(qrcode)
        const hass = await next()
        if (!hass) {
            console.error({ error: 'CAN_NOT_LOGIN' })
            await Bun.sleep(5000)
            process.exit(1)
        }
        return hass

    }


}