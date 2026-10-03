import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { CircleUserRound, KeyRound, ShieldCheck, WalletCards, X } from "lucide-react";
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
  detectWallet:()=>void;
  disconnect:()=>Promise<void>;
};

const AuthContext=createContext<AuthContextValue|null>(null);

export function RebytersAuthProvider({children}:{children:React.ReactNode}){
  const adapter=useWallet();
  const adapterAnchor=useAnchorWallet();
  const walletModal=useWalletModal();
  const [passkeyWallet,setPasskeyWallet]=useState<AnchorWallet|null>(null);
  const [loginOpen,setLoginOpen]=useState(false);

  const kind:AuthKind=passkeyWallet?"passkey":adapter.connected?"wallet":null;
  const anchorWallet=passkeyWallet??adapterAnchor;
  const publicKey=anchorWallet?.publicKey??adapter.publicKey??null;

  const signInWithPasskey=useCallback(async()=>{
    if(adapter.connected) await adapter.disconnect();
    const signer=await createOrGetPasskeyWallet();
    setPasskeyWallet(signer);
    setLoginOpen(false);
  },[adapter]);

  const detectWallet=useCallback(()=>{
    setPasskeyWallet(null);
    setLoginOpen(false);
    walletModal.setVisible(true);
  },[walletModal]);

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
    detectWallet,
    disconnect,
  }),[anchorWallet,detectWallet,disconnect,kind,loginOpen,publicKey,signInWithPasskey]);

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

      <button className="auth-detect-wallet" onClick={auth.detectWallet} disabled={busy}>
        <span><WalletCards/></span>
        <span><strong>Detect wallet</strong><small>Use any compatible Solana wallet installed on this device</small></span>
      </button>
      {!passkeysSupported()&&<p className="auth-note">Passkeys are not available in this browser. You can still connect a wallet.</p>}
      {error&&<p className="auth-error">{error}</p>}
    </section>
  </div>;
}
