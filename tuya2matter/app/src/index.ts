process.env.MATTER_NODEJS_CRYPTO = '0'

import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core"; 
import { CloudSync } from "./services/CloudSync.js";
import { SyncService } from "./services/Sync.js";
import { MatterService } from "./services/Matter.js";
import { LocalService } from "./services/Local.js";

console.log(`VERSION 1.0.5`)

@Module({
    providers: [
        CloudSync,
        SyncService,
        MatterService,
        LocalService
    ]
})
export class AppMoule { }


const app = await NestFactory.createApplicationContext(AppMoule)
await app.init()