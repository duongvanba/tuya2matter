import { Controller, Get } from "@nestjs/common";
import { TuyaDeviceService } from "../services/TuyaDeviceService.js";
import { firstValueFrom } from "rxjs";



@Controller()
export class DeviceController {


    constructor(private s: TuyaDeviceService) { }


    @Get()
    async devices() {
        if (this.s.homes$) {
            const devies = await firstValueFrom(this.s.homes$)
            return {
                data: { devies }
            }
        }
        return {
            message: 'initing',
            data: {
                devices: null
            }
        }
    }
}