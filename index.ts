import { LightweightMqtt } from './libs/tuya2mqtt/LightweightMqtt.js'
import { Manager } from './libs/Manager.js'


console.log('Running')

const require_params = ['MQTT_HOST', 'MQTT_PORT', 'MQTT_USERNAME', 'MQTT_PASSWORD', 'API_KEY', 'API_SECRET', 'USER_ID']
require_params.forEach(key => {
    if (!process.env[key]) throw new Error(`MISSING ENV ${key}`)
})


const mqtt = await LightweightMqtt.connect({
    host: process.env.MQTT_HOST!,
    port: Number(process.env.MQTT_PORT!),
    username: process.env.MQTT_USERNAME!,
    password: process.env.MQTT_PASSWORD!
})

console.log(`Mqtt connected`)

new Manager(mqtt)