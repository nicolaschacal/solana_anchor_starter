import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import { useAnchorWallet, useConnection, useWallet } from "@solana/wallet-adapter-react";
import { CircleUserRound, KeyRound, ShieldCheck, X } from "lucide-react";
import { fundTester, testerRequested, testerWallet } from "./tester";
import { createOrGetPasskeyWallet, passkeysSupported } from "./passkey";

type AuthKind="wallet"|"passkey"|"tester"|null;
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
  /** The wallet being connected right now (waiting for its approval), if any. */
  pendingWallet:string|null;
  connectError:string;
};

const AuthContext=createContext<AuthContextValue|null>(null);

export function RebytersAuthProvider({children}:{children:React.ReactNode}){
  const adapter=useWallet();
  const adapterAnchor=useAnchorWallet();
  const {connection}=useConnection();
  const [passkeyWallet,setPasskeyWallet]=useState<AnchorWallet|null>(null);
  const [tester,setTester]=useState<AnchorWallet|null>(()=>testerRequested()?testerWallet():null);
  const [testerNote,setTesterNote]=useState("");
  const [testerSol,setTesterSol]=useState<number|null>(null);
  useEffect(()=>{
    if(!tester) return;
    let cancelled=false;
    void fundTester(connection,tester).then(r=>{if(!cancelled){setTesterNote(r.note);setTesterSol(r.sol)}});
    return()=>{cancelled=true};
  },[connection,tester]);
  const [loginOpen,setLoginOpen]=useState(false);
  const [pendingWallet,setPendingWallet]=useState<string|null>(null);
  const [connectError,setConnectError]=useState("");
  const adapterRef=useRef(adapter);
  adapterRef.current=adapter;

  const kind:AuthKind=tester?"tester":passkeyWallet?"passkey":adapter.connected?"wallet":null;
  const anchorWallet=tester??passkeyWallet??adapterAnchor;
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
    setConnectError("");
    setPendingWallet(name);
    adapter.select(name as Parameters<typeof adapter.select>[0]);
  },[adapter]);

  // Connect once the chosen wallet is the selected one. This must not depend on the whole `adapter`
  // object (it changes on every wallet state change, which re-ran connect() while the wallet was still
  // asking for approval and cancelled the first attempt).
  const selectedName=String(adapter.wallet?.adapter.name??"");
  const busyConnecting=adapter.connecting;
  const alreadyConnected=adapter.connected;
  useEffect(()=>{
    if(!pendingWallet||selectedName!==pendingWallet) return;
    // The adapter's own autoConnect (it remembers the last wallet) may already be asking the wallet:
    // a second request on top of it makes the wallet answer "Connection rejected". Wait for it instead.
    if(alreadyConnected){
      setPendingWallet(null);
      setConnectError("");
      setLoginOpen(false);
      return;
    }
    if(busyConnecting) return;
    let live=true;
    const timer=window.setTimeout(()=>{
      if(live) setConnectError(`${pendingWallet} has not answered yet. Open its extension, unlock it and approve the connection; if nothing shows, reload the page and try again.`);
    },15000);
    adapterRef.current.connect()
      .then(()=>{
        setPendingWallet(null);
        setConnectError("");
        setLoginOpen(false);
      })
      .catch((e:unknown)=>{
        setPendingWallet(null);
        console.warn("Wallet connect failed:",e);
        const text=e instanceof Error?(e.message||e.name):String(e);
        setConnectError(`Could not connect ${pendingWallet}: ${text||"the wallet refused or did not respond"}`);
      })
      .finally(()=>window.clearTimeout(timer));
    return()=>{live=false;window.clearTimeout(timer)};
  },[pendingWallet,selectedName,busyConnecting,alreadyConnected]);

  const disconnect=useCallback(async()=>{
    if(tester){
      setTester(null);
      try{sessionStorage.removeItem("rebyters.tester.v1.on")}catch{/* ignore */}
      return;
    }
    if(passkeyWallet){
      setPasskeyWallet(null);
      return;
    }
    await adapter.disconnect();
  },[adapter,passkeyWallet,tester]);

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
    pendingWallet,
    connectError,
  }),[pendingWallet,connectError,anchorWallet,availableWallets,connectWallet,disconnect,kind,loginOpen,publicKey,signInWithPasskey]);

  return <AuthContext.Provider value={value}>{children}<RebytersLoginModal/>{tester&&<button type="button" className="tester-badge" onClick={()=>{void navigator.clipboard?.writeText(tester.publicKey.toBase58()).then(()=>setTesterNote("Address copied. Send devnet SOL to it (faucet.solana.com)."),()=>undefined)}}>TESTER · devnet · {testerSol===null?"…":`${testerSol.toFixed(2)} SOL`} · {tester.publicKey.toBase58().slice(0,4)}…{tester.publicKey.toBase58().slice(-4)}{testerNote&&<small>{testerNote}</small>}</button>}</AuthContext.Provider>;
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

  return <div className="auth-modal-backdrop rb-ui" onClick={()=>!busy&&auth.closeLogin()}>
    <section className="auth-modal" role="dialog" aria-modal="true" aria-label="Sign in to Rebyters" onClick={e=>e.stopPropagation()}>
      <div className="auth-sheet-handle"/>
      <button className="ui-close auth-close" onClick={auth.closeLogin} disabled={busy} aria-label="Close"><X/></button>
      <small className="auth-kicker">SECURE ACCESS</small>
      <h2>Sign in</h2>
      <p className="auth-copy">Use a passkey for a walletless experience, or connect any Solana wallet detected on this device.</p>

      <button className="ui-btn ui-btn-primary ui-btn-rich auth-passkey" onClick={()=>void passkey()} disabled={busy||!passkeysSupported()}>
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
              disabled={busy||!!auth.pendingWallet}
              onClick={()=>auth.connectWallet(item.name)}
            >
              <img src={item.icon} alt="" aria-hidden="true"/>
              <span><strong>{item.name}</strong><small>{auth.pendingWallet===item.name?"Waiting for the wallet… approve in its popup":item.readyState==="Installed"?"Ready to connect":"Available on this device"}</small></span>
            </button>)
          : <>
              {[
                {name:"Phantom",mark:"◆",kind:"phantom"},
                {name:"Solflare",mark:"S",kind:"solflare"},
                {name:"Backpack",mark:"B",kind:"backpack"},
              ].map(item=><button
                type="button"
                className={`auth-wallet-option fallback ${item.kind}`}
                key={item.name}
                disabled={busy}
                onClick={()=>{
                  const here=encodeURIComponent(window.location.href);
                  const ref=encodeURIComponent(window.location.origin);
                  const mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
                  if(!mobile){
                    window.open(
                      item.kind==="phantom"?"https://phantom.com/":
                      item.kind==="solflare"?"https://solflare.com/":
                      "https://backpack.app/",
                      "_blank",
                      "noopener,noreferrer",
                    );
                    return;
                  }
                  if(item.kind==="phantom"){
                    window.location.href=`https://phantom.app/ul/browse/${here}`;
                  }else if(item.kind==="solflare"){
                    window.location.href=`https://solflare.com/ul/v1/browse/${here}?ref=${ref}`;
                  }else{
                    window.location.href=`https://backpack.app/ul/v1/browse/${here}?ref=${ref}`;
                  }
                }}
              >
                <span className="fallback-wallet-mark" aria-hidden="true">{item.mark}</span>
                <span><strong>{item.name}</strong><small>Open Rebyters in {item.name}</small></span>
              </button>)}
            </>}
      </div>
      {!passkeysSupported()&&<p className="auth-note">Passkeys are not available in this browser. You can still connect a detected wallet.</p>}
      {(error||auth.connectError)&&<p className="auth-error">{error||auth.connectError}</p>}
    </section>
  </div>;
}
