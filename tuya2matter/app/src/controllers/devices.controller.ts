import { Controller, Get } from "@nestjs/common";
import { CloudConfig } from "../services/CloudConfig.js";



@Controller()
export class DeviceController {


    constructor(private cloud: CloudConfig) { }


    @Get()
    devices() {
        if (this.cloud.value) {
            const { config } = this.cloud.value
            return {
                data: {
                    devies: config
                }
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