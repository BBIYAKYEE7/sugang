import React from 'react';
import './App.css';
import { Analytics } from '@vercel/analytics/react';

const RELEASE_URL = 'https://github.com/BBIYAKYEE7/sugang/releases/latest';

async function fetchLatestAssets(platform) {
  try {
    const res = await fetch('https://api.github.com/repos/BBIYAKYEE7/sugang/releases/latest', { headers: { 'Accept': 'application/vnd.github+json' } });
    if (!res.ok) throw new Error('Failed to fetch releases');
    const data = await res.json();
    
    const assets = data.assets || [];
    const platformAssets = [];
    
    if (platform === 'windows') {
      // Windows 에셋들 찾기
      assets.forEach(asset => {
        if (/windows|\.exe$/i.test(asset.name) && !/mac|linux/i.test(asset.name)) {
          if (/x64|amd64/i.test(asset.name)) {
            platformAssets.push({ name: 'Windows x64', url: asset.browser_download_url, filename: asset.name });
          } else if (/x86|i386/i.test(asset.name)) {
            platformAssets.push({ name: 'Windows x86', url: asset.browser_download_url, filename: asset.name });
          } else if (/arm64/i.test(asset.name)) {
            platformAssets.push({ name: 'Windows ARM64', url: asset.browser_download_url, filename: asset.name });
          } else {
            platformAssets.push({ name: 'Windows', url: asset.browser_download_url, filename: asset.name });
          }
        }
      });
    } else if (platform === 'mac') {
      // macOS 에셋들 찾기
      assets.forEach(asset => {
        if (/mac|\.dmg$|\.pkg$/i.test(asset.name) && !/windows|linux/i.test(asset.name)) {
          if (/arm64|m1|m2|apple/i.test(asset.name)) {
            platformAssets.push({ name: 'macOS Apple Silicon', url: asset.browser_download_url, filename: asset.name });
          } else if (/intel|x86_64/i.test(asset.name)) {
            platformAssets.push({ name: 'macOS Intel', url: asset.browser_download_url, filename: asset.name });
          } else {
            platformAssets.push({ name: 'macOS', url: asset.browser_download_url, filename: asset.name });
          }
        }
      });
    } else if (platform === 'linux') {
      // Linux 에셋들 찾기
      assets.forEach(asset => {
        if (/linux|\.AppImage$|\.deb$|\.rpm$/i.test(asset.name) && !/windows|mac/i.test(asset.name)) {
          if (/x64|amd64/i.test(asset.name)) {
            platformAssets.push({ name: 'Linux x64', url: asset.browser_download_url, filename: asset.name });
          } else if (/x86|i386/i.test(asset.name)) {
            platformAssets.push({ name: 'Linux x86', url: asset.browser_download_url, filename: asset.name });
          } else if (/arm64|aarch64/i.test(asset.name)) {
            platformAssets.push({ name: 'Linux ARM64', url: asset.browser_download_url, filename: asset.name });
          } else if (/arm|armv7/i.test(asset.name)) {
            platformAssets.push({ name: 'Linux ARM', url: asset.browser_download_url, filename: asset.name });
          } else {
            platformAssets.push({ name: 'Linux', url: asset.browser_download_url, filename: asset.name });
          }
        }
      });
    }
    
    return platformAssets.length > 0 ? platformAssets : [{ name: 'GitHub Releases', url: RELEASE_URL, filename: 'releases' }];
  } catch (e) {
    return [{ name: 'GitHub Releases', url: RELEASE_URL, filename: 'releases' }];
  }
}

async function fetchLatestAssetUrl(platform) {
  const assets = await fetchLatestAssets(platform);
  return assets[0]?.url || RELEASE_URL;
}

function detectOS() {
  const ua = navigator.userAgent;
  if (/Windows NT/i.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'mac';
  if (/Linux/i.test(ua)) return 'linux';
  return 'unknown';
}

function App() {
  const os = detectOS();
  const primaryText = os === 'mac' ? 'macOS용 다운로드' : os === 'windows' ? 'Windows용 다운로드' : os === 'linux' ? 'Linux용 다운로드' : '최신 버전 보기';
  const storedTheme = typeof window !== 'undefined' ? localStorage.getItem('theme') : null;
  const [showModal, setShowModal] = React.useState(false);
  const [isClosing, setIsClosing] = React.useState(false);
  const [modalAssets, setModalAssets] = React.useState([]);
  const [modalPlatform, setModalPlatform] = React.useState('');
  
  React.useEffect(() => {
    if (storedTheme) {
      document.documentElement.setAttribute('data-theme', storedTheme);
    }
  }, [storedTheme]);
  
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
    if (current === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('theme', 'dark');
    }
    // 아이콘 교체 (라이트 모드에서 120주년 아이콘으로)
    const badge = document.querySelector('.footer-badge');
    const themeNow = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    if (badge) {
      badge.src = themeNow === 'light' ? '/images/kuni120-1-hd.png' : '/images/kuni120-2.png';
    }
  }
  
  async function handleWindowsClick(e) {
    e.preventDefault();
    await showArchitectureSelector('windows');
  }
  
  async function handleMacClick(e) {
    e.preventDefault();
    await showArchitectureSelector('mac');
  }
  
  async function handleLinuxClick(e) {
    e.preventDefault();
    await showArchitectureSelector('linux');
  }
  
  async function showArchitectureSelector(platform) {
    const assets = await fetchLatestAssets(platform);
    
    if (assets.length === 1 && assets[0].filename === 'releases') {
      // 에셋을 찾지 못한 경우 GitHub Releases로 이동
      window.location.href = assets[0].url;
      return;
    }
    
    if (assets.length === 1) {
      // 에셋이 하나만 있는 경우 바로 다운로드
      window.location.href = assets[0].url;
      return;
    }
    
    // 여러 아키텍처가 있는 경우 모달 표시
    setModalAssets(assets);
    setModalPlatform(platform);
    setShowModal(true);
  }

  function handleAssetSelect(url) {
    window.location.href = url;
    setShowModal(false);
  }

  function closeModal() {
    setIsClosing(true);
    setTimeout(() => {
      setShowModal(false);
      setIsClosing(false);
    }, 300); // 애니메이션 지속 시간과 동일하게 설정
  }

  async function handlePrimaryClick(e) {
    e.preventDefault();
    if (os === 'windows') {
      await showArchitectureSelector('windows');
    } else if (os === 'mac') {
      await showArchitectureSelector('mac');
    } else if (os === 'linux') {
      await showArchitectureSelector('linux');
    } else {
      alert('지원되지 않는 운영체제입니다. Windows, macOS, Linux 버전을 제공합니다.');
    }
  }

  return (
    <div className="theme-transition">
      <header className="header glass" role="banner">
        <div className="container header-inner">
          <a className="brand" href="#top" aria-label="고려대학교 수강신청 홈">
            <img className="brand-logo-wide" src="/images/kulogo(r).png" alt="고려대로고" width="125" height="36"/>
          </a>
          
          {/* 테마변경 버튼 */}
          <a className="btn" href="#" onClick={(e)=>{e.preventDefault();toggleTheme();}} aria-label="테마 전환">테마 전환</a>
        </div>
      </header>

      <main id="top" className="main" role="main">
        <section className="container hero" aria-labelledby="hero-title">
          <div>
            <h1 id="hero-title">고려대학교 수강신청</h1>
            <p className="subtitle">정각과 30분마다 자동으로 수강신청 사이트에 로그인하여 원하는 과목을 놓치지 마세요</p>
            <p className="notice">⚠️ 이 프로젝트는 고려대학교의 공식 프로젝트가 아닙니다. 개인 개발자가 만든 비공식 앱입니다.</p>
            <div className="cta">
              <a className="btn btn-primary" href="#" onClick={handlePrimaryClick} aria-describedby="primary-desc">{primaryText}</a>
              <p id="primary-desc" className="vh">접속한 운영체제를 자동으로 감지하여 올바른 설치 파일을 안내합니다.</p>
              <a className="btn btn-ghost" href="#features">자세히 보기</a>
            </div>
          </div>
          <div>
            <img className="hero-image hero-image--wide" src="/images/emblem.png" alt="고려대학교 엠블럼" />
          </div>
        </section>

        <section id="features" className="section container" aria-labelledby="feature-title">
          <h2 id="feature-title">주요 기능</h2>
          <ul className="features">
            <li className="glass">
              <h3>자동 로그인</h3>
              <p>정각과 30분마다 자동으로 수강신청 사이트에 로그인하여 원하는 과목을 놓치지 않습니다.</p>
            </li>
            <li className="glass">
              <h3>안전한 정보 관리</h3>
              <p>학번과 비밀번호를 로컬에 안전하게 저장하여 보안을 유지합니다.</p>
            </li>
            <li className="glass">
              <h3>서버 시간 표시</h3>
              <p>수강신청 서버의 정확한 시간을 실시간으로 확인할 수 있습니다.</p>
            </li>
            <li className="glass">
              <h3>크로스 플랫폼</h3>
              <p>macOS, Windows, Linux에서 동일한 경험을 제공합니다. 모든 주요 운영체제를 지원합니다.</p>
            </li>
          </ul>
        </section>

        <section id="download" className="section section-alt" aria-labelledby="download-title">
          <div className="container">
            <h2 id="download-title">다운로드</h2>
            <p className="muted">아래에서 운영체제에 맞는 설치 파일을 선택하세요. 아키텍처별로 다운로드할 수 있습니다.</p>
            <div className="download">
              <a className="card glass" href="#" onClick={handleMacClick} aria-label="macOS용 다운로드">
                <div className="card-body">
                  <span className="os">macOS</span>
                  <span className="hint">Apple Silicon / Intel</span>
                </div>
              </a>
              <a className="card glass" href="#" onClick={handleWindowsClick} aria-label="Windows용 다운로드">
                <div className="card-body">
                  <span className="os">Windows</span>
                  <span className="hint">x64 / x86 / ARM64</span>
                </div>
              </a>
              <a className="card glass" href="#" onClick={handleLinuxClick} aria-label="Linux용 다운로드">
                <div className="card-body">
                  <span className="os">Linux</span>
                  <span className="hint">x64 / x86 / ARM64 / ARM</span>
                </div>
              </a>
            </div>
            <p className="tiny">최신 릴리즈는 GitHub에서 제공됩니다. 다운로드가 시작되지 않으면 릴리즈 페이지에서 수동으로 선택하세요.</p>
          </div>
        </section>

        <section id="faq" className="section container" aria-labelledby="faq-title">
          <h2 id="faq-title">자주 묻는 질문</h2>
          <details>
            <summary>실행 시 보안 경고가 나와요.</summary>
            <p>맞습니다. 윈도우의 보안정책상 SmartScreen 경고가 나옵니다. 이는 이 가난한 개발자가 윈도우의 인증을 받지 못했기 때문에 발생하는 것입니다. 이 경고가 뜨면 그냥 실행 누르시면 설치가 됩니다.</p>
          </details>
          <details>
            <summary>자동 로그인은 어떻게 작동하나요?</summary>
            <p>앱은 정각과 30분마다 자동으로 수강신청 사이트에 로그인을 시도합니다. 설정에서 로그인 주기를 조정할 수 있습니다.</p>
          </details>
          <details>
            <summary>로그인 정보는 안전한가요?</summary>
            <p>네, 학번과 비밀번호는 로컬 컴퓨터에만 저장되며 외부로 전송되지 않습니다. 모든 정보는 암호화되어 안전하게 보관됩니다.</p>
          </details>
        </section>
      </main>

      <footer className="footer" role="contentinfo">
        <div className="container">
          <div className="footer-inner glass">
            <img className="footer-badge" src="/images/kuni120-2.png" alt="고려대학교 120주년 아이콘" width="24" height="24" />
            <h3 className="footer-brand">BBIYAKYEE7</h3>
            <p className="footer-sub">2025 © Copyright by BBIYAKYEE7, All rights reserved.</p>
            <p className="footer-sub">Made and serviced with React.js</p>
            <div className="footer-ctas">
              <a className="btn-footer" href="mailto:bbiyakyee7@gmail.com" aria-label="Email">✉️ 이메일</a>
              <a className="btn-footer" href="https://github.com/BBIYAKYEE7" target="_blank" rel="noopener noreferrer" aria-label="GitHub">🐙 GitHub</a>
              <a className="btn-footer" href="https://instagram.com/bbiyakyee7" target="_blank" rel="noopener noreferrer" aria-label="Instagram">📷 Instagram</a>
            </div>
          </div>
        </div>
      </footer>

      {/* 아키텍처 선택 모달 */}
      {showModal && (
        <div className={`modal-overlay ${isClosing ? 'closing' : ''}`} onClick={closeModal}>
          <div className={`modal-content glass ${isClosing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>아키텍처 선택</h3>
              <button className="modal-close" onClick={closeModal} aria-label="닫기">×</button>
            </div>
            <div className="modal-body">
              <p>사용 가능한 {modalPlatform === 'windows' ? 'Windows' : modalPlatform === 'mac' ? 'macOS' : 'Linux'} 아키텍처를 선택하세요:</p>
              <div className="modal-assets">
                {modalAssets.map((asset, index) => (
                  <button
                    key={index}
                    className="modal-asset-btn"
                    onClick={() => handleAssetSelect(asset.url)}
                  >
                    <span className="asset-name">{asset.name}</span>
                    <span className="asset-filename">{asset.filename}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      <Analytics />
    </div>
  );
}

export default App;
