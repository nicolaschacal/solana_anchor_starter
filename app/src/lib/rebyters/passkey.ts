import { sha256 } from "@noble/hashes/sha256";
import { Keypair, PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";

const RP_NAME = "Rebyters";
const STORAGE_KEY = "rebyters.passkey.v1";
const PRF_SALT = new TextEncoder().encode("rebyters:solana:ed25519:v1");

function bufferToB64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  bytes.forEach(byte => { binary += String.fromCharCode(byte); });
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function b64ToBuffer(value:string) {
  const padded=value.replace(/-/g,"+").replace(/_/g,"/");
  const raw=atob(padded);
  return Uint8Array.from(raw,char=>char.charCodeAt(0));
}
function hostname() {
  return window.location.hostname==="localhost"?"localhost":window.location.hostname;
}
function readStore():{id:string;pubkey:string}|null {
  try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||"null")}catch{return null}
}
function writeStore(data:{id:string;pubkey:string}) {
  localStorage.setItem(STORAGE_KEY,JSON.stringify(data));
}
function getPrfBytes(credential:any) {
  const results=credential.getClientExtensionResults?.()?.prf?.results?.first;
  if(!results) throw new Error("This device supports passkeys but does not expose PRF. Use a wallet instead.");
  return new Uint8Array(results);
}
function publicKeyOptions(challenge:Uint8Array,extra:Record<string,unknown>={}) {
  return {
    challenge,
    rpId:hostname(),
    userVerification:"required",
    extensions:{prf:{eval:{first:PRF_SALT}}},
    ...extra,
  } as any;
}
export function passkeysSupported() {
  return typeof window.PublicKeyCredential==="function";
}
function makeWallet(keypair:Keypair):AnchorWallet {
  return {
    publicKey:keypair.publicKey,
    async signTransaction<T extends Transaction|VersionedTransaction>(transaction:T):Promise<T> {
      if(transaction instanceof Transaction) transaction.partialSign(keypair);
      else transaction.sign([keypair]);
      return transaction;
    },
    async signAllTransactions<T extends Transaction|VersionedTransaction>(transactions:T[]):Promise<T[]> {
      transactions.forEach(transaction=>{
        if(transaction instanceof Transaction) transaction.partialSign(keypair);
        else transaction.sign([keypair]);
      });
      return transactions;
    },
  };
}
export async function createOrGetPasskeyWallet():Promise<AnchorWallet> {
  if(!passkeysSupported()) throw new Error("Passkeys are not available in this browser.");
  const stored=readStore();
  const challenge=crypto.getRandomValues(new Uint8Array(32));

  try{
    const existing=await navigator.credentials.get({
      publicKey:publicKeyOptions(challenge,stored?.id?{
        allowCredentials:[{type:"public-key",id:b64ToBuffer(stored.id)}],
      }:{}),
      mediation:"optional",
    } as any) as any;
    if(existing){
      const keypair=Keypair.fromSeed(sha256(getPrfBytes(existing)));
      writeStore({id:bufferToB64(existing.rawId),pubkey:keypair.publicKey.toBase58()});
      return makeWallet(keypair);
    }
  }catch{
    // No usable saved credential on this device; create one below.
  }

  const userId=crypto.getRandomValues(new Uint8Array(16));
  const created=await navigator.credentials.create({
    publicKey:{
      rp:{name:RP_NAME,id:hostname()},
      user:{
        id:userId,
        name:`rebyters-${bufferToB64(userId.buffer).slice(0,8)}`,
        displayName:"Rebyters",
      },
      challenge:crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams:[
        {type:"public-key",alg:-8},
        {type:"public-key",alg:-7},
        {type:"public-key",alg:-257},
      ],
      authenticatorSelection:{
        residentKey:"preferred",
        requireResidentKey:false,
        userVerification:"required",
      },
      timeout:120000,
      extensions:{prf:{eval:{first:PRF_SALT}}},
    } as any,
  } as any) as any;
  if(!created) throw new Error("Passkey creation was cancelled.");

  let prf:Uint8Array;
  try{
    prf=getPrfBytes(created);
  }catch{
    const followUp=await navigator.credentials.get({
      publicKey:publicKeyOptions(crypto.getRandomValues(new Uint8Array(32)),{
        allowCredentials:[{type:"public-key",id:created.rawId}],
      }),
    } as any) as any;
    prf=getPrfBytes(followUp);
  }
  const keypair=Keypair.fromSeed(sha256(prf));
  writeStore({id:bufferToB64(created.rawId),pubkey:keypair.publicKey.toBase58()});
  return makeWallet(keypair);
}
export function storedPasskeyPublicKey():PublicKey|null {
  try{
    const pubkey=readStore()?.pubkey;
    return pubkey?new PublicKey(pubkey):null;
  }catch{return null}
}
