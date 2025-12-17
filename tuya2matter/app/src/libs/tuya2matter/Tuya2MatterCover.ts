import { AggregatorEndpoint, } from "@matter/main/endpoints/aggregator";
import { TuyaDevice } from "../tuyapi/TuyaDevice.js";
import { Endpoint, MaybePromise } from "@matter/main";
import { WindowCoveringDevice } from "@matter/main/devices";
import { BridgedDeviceBasicInformationServer } from "@matter/main/behaviors";
import { MovementDirection, MovementType, WindowCoveringServer } from "@matter/main/behaviors";
import { map, merge, mergeMap, of, Subject, switchMap, tap, timer } from "rxjs";


const LiftingWindowCoveringServer = WindowCoveringServer.with("Lift", "PositionAwareLift", "AbsolutePosition");


export class Tuya2MatterCover {
    constructor(
        public readonly aggregator: Endpoint<AggregatorEndpoint>,
        public readonly tuya: TuyaDevice
    ) { }

    link() {

        const name = this.tuya.name.slice(0, 32)

        const tuya = this.tuya

        const cmd$ = new Subject<'open' | 'close' | 'stop'>()

        const endpoint = new Endpoint(
            WindowCoveringDevice.with(class extends LiftingWindowCoveringServer {
                override async handleMovement(
                    type: MovementType,
                    reversed: boolean,
                    direction: MovementDirection,
                    targetPercent100ths?: number,
                ) {
                    if (tuya.mapping.percent_control) {
                        targetPercent100ths != undefined && tuya.setDps({
                            percent_control: targetPercent100ths / 100
                        })
                        cmd$.next(direction == MovementDirection.Open ? 'open' : 'close')
                    } else {
                        const control = targetPercent100ths == 10000 ? 'close' : (
                            targetPercent100ths == 0 ? 'open' : 'stop'
                        )
                        tuya.setDps({ control })
                        cmd$.next(control as 'open' | 'close' | 'stop')
                    }

                }
                override handleStopMovement(): MaybePromise {
                    tuya.setDps({
                        control: 'stop'
                    })
                    cmd$.next('stop')
                }

                override downOrClose(): MaybePromise {
                    tuya.setDps({
                        control: 'close'
                    })
                    cmd$.next('close')
                }

                override upOrOpen(): MaybePromise {
                    tuya.setDps({
                        control: 'open'
                    })
                    cmd$.next('open')
                }

            }).with(BridgedDeviceBasicInformationServer), {
            id: this.tuya.id,
            bridgedDeviceBasicInformation: {
                nodeLabel: name,
                productName: name,
                productLabel: name,
                serialNumber: this.tuya.config.uuid,
                reachable: false,
            },
            windowCovering: {
                operationalStatus: { lift: 0 }
            }
        })


        const observable = merge(
            cmd$.pipe(
                switchMap(cmd => {
                    if (cmd == 'stop') return of(1)
                    const lift = cmd == 'open' ? 1 : 2
                    endpoint.set({ windowCovering: { operationalStatus: { lift } } })
                    return timer(5000).pipe(
                        tap(() => {
                            endpoint.set({ windowCovering: { operationalStatus: { lift: 0 } } })
                        })
                    )
                })
            ),
            this.tuya.$dps.pipe(
                map(d => d.state),
                mergeMap(async dps => {
                    dps.control && cmd$.next(dps.control as 'open' | 'close' | 'stop')
                    if (dps.percent_control != undefined) {
                        const targetPositionLiftPercent100ths = Number(dps.percent_control) * 100 
                        endpoint.set({ windowCovering: { targetPositionLiftPercent100ths } })
                    }

                    if (dps.percent_state != undefined) {
                        const currentPositionLiftPercent100ths = Number(dps.percent_state) * 100
                        endpoint.set({ windowCovering: { currentPositionLiftPercent100ths } })
                    }
                })
            )
        )

        return {
            endpoint: endpoint as Endpoint,
            observable
        }



    }


}