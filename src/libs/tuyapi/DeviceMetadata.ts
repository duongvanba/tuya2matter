export type DeviceMetadata = {
    id: string,
    ip: string
    port?: number
    version: string
    local_key: string
    category: string
    node_id?: string
    name: string
    mac: string
    sub: boolean,
    product_name: string
    mapping: {
        [key: string]: {
            code: string,
            dp_id: string | number
        }
    },
    model: string,
    online: boolean
    home_id: string
    gateway_id?: string
    is_gateway: boolean
}
