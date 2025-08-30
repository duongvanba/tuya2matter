import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { CloudConfig } from "./services/CloudConfig.js";
import { TuyaDeviceService } from "./services/TuyaDeviceService.js";
import { SyncService } from "./services/Sync.js";
import { MatterService } from "./services/Matter.js";
import { DeviceController } from "./controllers/devices.controller.js";


@Module({
    controllers: [DeviceController],
    providers: [
        CloudConfig,
        SyncService,
        MatterService,
        TuyaDeviceService
    ]
})
export class AppMoule { }


const app = await NestFactory.create(AppMoule)
await app.listen(13879) 