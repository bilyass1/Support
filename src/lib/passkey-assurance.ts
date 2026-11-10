/**
 * WebAuthn authenticator data: 32-byte RP ID hash, then one flags byte. Bit 0 is user presence,
 * bit 2 is user verification (biometric or device PIN). The assertion signature covers these
 * bytes, so once the library has verified the signature the flag can be trusted.
 */
export function userVerified(authenticatorData:unknown){
 if(typeof authenticatorData!=='string'||!/^[A-Za-z0-9_-]{50,2000}$/.test(authenticatorData))return false;
 const bytes=Buffer.from(authenticatorData,'base64url');
 return bytes.length>=37&&(bytes[32]&0x05)===0x05;
}
