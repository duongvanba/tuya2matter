import { Injectable } from "@nestjs/common";
import { TuyaDevice } from "../libs/tuyapi/TuyaDevice.js";
import { Observable } from "rxjs";




@Injectable()
export class LocalService { 

    get devices$(){
        return new Observable<TuyaDevice>(o => {})
    }
 
}