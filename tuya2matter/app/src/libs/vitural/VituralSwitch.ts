import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { Endpoint, Observable } from "@matter/main";
import { OnOffPlugInUnitDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { EMPTY } from "rxjs";



export class VituralSwitch {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly id: string,
        public readonly name: string
    ) { }

    start() {


        const bridgedDeviceBasicInformation = {
            nodeLabel: this.name,
            productName: this.name,
            productLabel: this.name,
            serialNumber: this.id,
            reachable: false
        }



        const endpoint = new Endpoint(OnOffPlugInUnitDevice.with(
            BridgedDeviceBasicInformationServer
        ), {
            id: this.id,
            bridgedDeviceBasicInformation
        })

        this.aggregator.add(endpoint)

        return new Observable<any>(o => {
            return () => endpoint.delete()
        })

    }
}