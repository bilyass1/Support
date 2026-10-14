import {test,expect} from '@playwright/test';
import {createHmac} from 'node:crypto';
function totp(secret:string){let bits=0,value=0;const bytes:number[]=[];for(const c of secret.toUpperCase()){value=value<<5|'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c);bits+=5;if(bits>=8){bytes.push(value>>>(bits-8)&255);bits-=8;}}const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const hash=createHmac('sha1',Buffer.from(bytes)).update(counter).digest(),offset=hash.at(-1)!&15;return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0');}
test('first login requires authenticator; CSP permits hydration and the next login challenges again',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/login');await expect(page.getByAltText('Solumove Technologies')).toBeVisible();
 await page.getByRole('button',{name:'Créer un compte',exact:true}).click();
 await page.getByLabel('Nom',{exact:true}).fill('CI Client');await page.getByLabel('Adresse e-mail').fill('ci-'+Date.now()+'@example.com');const email=await page.getByLabel('Adresse e-mail').inputValue();await page.getByLabel('Mot de passe',{exact:true}).fill('Test-Password-123456');
 await page.getByRole('button',{name:'Créer le compte',exact:true}).click();await expect(page).toHaveURL(/\/security$/);
 await page.getByLabel('Votre mot de passe actuel').fill('Test-Password-123456');await page.getByRole('button',{name:'Configurer l’authenticator'}).click();
 await page.getByText('Clé manuelle',{exact:true}).click();const secret=await page.locator('details code').first().innerText();await page.getByLabel('J’ai conservé mes codes de secours.').check();await page.getByLabel('Code à six chiffres').fill(totp(secret));await page.getByRole('button',{name:'Vérifier et continuer'}).click();await expect(page).toHaveURL('http://127.0.0.1:3000/');await expect(page.getByText('Votre compte est prêt')).toBeVisible();
 await page.screenshot({path:'test-results/client-light.png',fullPage:true});
 await page.getByRole('button',{name:'Mode sombre',exact:true}).click();await page.screenshot({path:'test-results/client-midnight.png',fullPage:true});
 await page.getByRole('button',{name:'Se déconnecter',exact:true}).click();await expect(page).toHaveURL(/\/login$/);await page.getByLabel('Adresse e-mail').fill(email);await page.getByLabel('Mot de passe',{exact:true}).fill('Test-Password-123456');await page.getByRole('button',{name:'Se connecter',exact:true}).click();await expect(page).toHaveURL(/\/two-factor$/);await page.getByLabel('Code à six chiffres').fill(totp(secret));await page.getByRole('button',{name:'Vérifier et continuer'}).click();await expect(page).toHaveURL('http://127.0.0.1:3000/');expect(errors).toEqual([]);
});
