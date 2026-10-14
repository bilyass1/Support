import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'./e2e',workers:1,timeout:60000,use:{baseURL:'http://127.0.0.1:3000',trace:'off',screenshot:'off'},webServer:{command:'npm start -- --hostname 127.0.0.1 --port 3000',url:'http://127.0.0.1:3000/login',reuseExistingServer:false,timeout:60000},reporter:'list'});
