const node_options = [
    '--max-old-space-size=4096',
    '--no-warnings',
    '--es-module-specifier-resolution=node',
    '--experimental-specifier-resolution=node'
]


module.exports = {
    apps: {
        name: `tuya2mqtt`,
        script: `env-cmd --file .env node ${node_options.join(' ')} build/index.js`,
        autorestart: true,
        max_memory_restart: '4096M'
    }
}