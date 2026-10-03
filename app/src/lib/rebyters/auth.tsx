import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { CircleUserRound, KeyRound, ShieldCheck, X } from "lucide-react";
import { createOrGetPasskeyWallet, passkeysSupported } from "./passkey";

type AuthKind="wallet"|"passkey"|null;
type AuthContextValue={
  connected:boolean;
  kind:AuthKind;
  publicKey:AnchorWallet["publicKey"]|null;
  anchorWallet:AnchorWallet|undefined;
  wallet:{
    publicKey:AnchorWallet["publicKey"]|null;
    signTransaction?:AnchorWallet["signTransaction"];
  };
  loginOpen:boolean;
  openLogin:()=>void;
  closeLogin:()=>void;
  signInWithPasskey:()=>Promise<void>;
  availableWallets:Array<{name:string;icon:string;readyState:string}>;
  connectWallet:(name:string)=>void;
  disconnect:()=>Promise<void>;
};

const AuthContext=createContext<AuthContextValue|null>(null);

export function RebytersAuthProvider({children}:{children:React.ReactNode}){
  const adapter=useWallet();
  const adapterAnchor=useAnchorWallet();
  const [passkeyWallet,setPasskeyWallet]=useState<AnchorWallet|null>(null);
  const [loginOpen,setLoginOpen]=useState(false);
  const [pendingWallet,setPendingWallet]=useState<string|null>(null);

  const kind:AuthKind=passkeyWallet?"passkey":adapter.connected?"wallet":null;
  const anchorWallet=passkeyWallet??adapterAnchor;
  const publicKey=anchorWallet?.publicKey??adapter.publicKey??null;

  const signInWithPasskey=useCallback(async()=>{
    if(adapter.connected) await adapter.disconnect();
    const signer=await createOrGetPasskeyWallet();
    setPasskeyWallet(signer);
    setLoginOpen(false);
  },[adapter]);

  const availableWallets=useMemo(
    ()=>adapter.wallets
      .filter(item=>String(item.readyState)!=="Unsupported"&&String(item.readyState)!=="NotDetected")
      .map(item=>({
        name:String(item.adapter.name),
        icon:item.adapter.icon,
        readyState:String(item.readyState),
      })),
    [adapter.wallets],
  );

  const connectWallet=useCallback((name:string)=>{
    setPasskeyWallet(null);
    setPendingWallet(name);
    adapter.select(name as Parameters<typeof adapter.select>[0]);
  },[adapter]);

  useEffect(()=>{
    if(!pendingWallet) return;
    if(String(adapter.wallet?.adapter.name??"")!==pendingWallet) return;
    let cancelled=false;
    void adapter.connect()
      .then(()=>{
        if(cancelled) return;
        setPendingWallet(null);
        setLoginOpen(false);
      })
      .catch(()=>{
        if(cancelled) return;
        setPendingWallet(null);
      });
    return()=>{cancelled=true};
  },[adapter,pendingWallet]);

  const disconnect=useCallback(async()=>{
    if(passkeyWallet){
      setPasskeyWallet(null);
      return;
    }
    await adapter.disconnect();
  },[adapter,passkeyWallet]);

  const value=useMemo<AuthContextValue>(()=>({
    connected:!!publicKey,
    kind,
    publicKey,
    anchorWallet,
    wallet:{
      publicKey,
      signTransaction:anchorWallet?.signTransaction,
    },
    loginOpen,
    openLogin:()=>setLoginOpen(true),
    closeLogin:()=>setLoginOpen(false),
    signInWithPasskey,
    availableWallets,
    connectWallet,
    disconnect,
  }),[anchorWallet,availableWallets,connectWallet,disconnect,kind,loginOpen,publicKey,signInWithPasskey]);

  return <AuthContext.Provider value={value}>{children}<RebytersLoginModal/></AuthContext.Provider>;
}

export function useRebytersAuth(){
  const value=useContext(AuthContext);
  if(!value) throw new Error("useRebytersAuth must be used inside RebytersAuthProvider");
  return value;
}

export function RebytersLoginButton({className=""}:{className?:string}){
  const auth=useRebytersAuth();
  return <button type="button" className={className||"rebyters-login-trigger"} onClick={auth.openLogin}>
    <CircleUserRound/><span>Login</span>
  </button>;
}

function RebytersLoginModal(){
  const auth=useContext(AuthContext);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  if(!auth?.loginOpen) return null;

  async function passkey(){
    setBusy(true);setError("");
    try{await auth!.signInWithPasskey()}
    catch(e){setError(e instanceof Error?e.message:String(e))}
    finally{setBusy(false)}
  }

  return <div className="auth-modal-backdrop" onClick={()=>!busy&&auth.closeLogin()}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-label="Sign in to Rebyters" onClick={e=>e.stopPropagation()}>
      <div className="auth-sheet-handle"/>
      <button className="auth-close" onClick={auth.closeLogin} disabled={busy} aria-label="Close"><X/></button>
      <small className="auth-kicker">SECURE ACCESS</small>
      <h2>Sign in</h2>
      <p className="auth-copy">Use a passkey for a walletless experience, or connect any Solana wallet detected on this device.</p>

      <button className="auth-passkey" onClick={()=>void passkey()} disabled={busy||!passkeysSupported()}>
        <span><KeyRound/></span>
        <span><strong>{busy?"Waiting for passkey…":"Sign in with passkey"}</strong><small>Face ID, Touch ID or your device passkey</small></span>
        <ShieldCheck/>
      </button>

      <div className="auth-or"><span>or connect a wallet</span></div>

      <div className="auth-wallet-list">
        {auth.availableWallets.length
          ? auth.availableWallets.map(item=><button
              type="button"
              className="auth-wallet-option"
              key={item.name}
              disabled={busy}
              onClick={()=>auth.connectWallet(item.name)}
            >
              <img src={item.icon} alt="" aria-hidden="true"/>
              <span><strong>{item.name}</strong><small>{item.readyState==="Installed"?"Ready to connect":"Available on this device"}</small></span>
            </button>)
          : <div className="auth-no-wallet"><strong>No wallet detected</strong><small>Install or open a compatible Solana wallet, or use a passkey.</small></div>}
      </div>
      {!passkeysSupported()&&<p className="auth-note">Passkeys are not available in this browser. You can still connect a detected wallet.</p>}
      {error&&<p className="auth-error">{error}</p>}
    </section>
  </div>;
}
