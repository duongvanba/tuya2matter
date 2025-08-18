import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { LinkService } from "./services/Link.js";



@Module({
    providers: [
        LinkService
    ]
})
export class AppMoule { }


const app = await NestFactory.createApplicationContext(AppMoule)
await app.init()