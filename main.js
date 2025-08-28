const { app, BrowserWindow, ipcMain, dialog, screen, Menu } = require('electron');
const path = require('path');
const Store = require('electron-store');
const https = require('https');

// 설정 저장소 초기화
const store = new Store();

let mainWindow;
let loginModal;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1400,
    minHeight: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      enableRemoteModule: false,
      webSecurity: false, // iframe 접근을 위해 false로 설정
      preload: path.join(__dirname, 'preload.js'),
      allowRunningInsecureContent: true
    },
    icon: path.join(__dirname, 'images', 'logo.png'),
    title: '고려대학교 수강신청',
    show: false
  });

  // 메뉴바 설정
  const template = [
    {
      label: '파일',
      submenu: [
        {
          label: '로그인 정보 수정',
          accelerator: 'CmdOrCtrl+L',
          click: () => {
            createLoginWindow();
          }
        },
        {
          label: '로그인 정보 삭제',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'question',
              title: '로그인 정보 삭제',
              message: '저장된 로그인 정보를 삭제하시겠습니까?',
              buttons: ['취소', '삭제'],
              defaultId: 0,
              cancelId: 0
            }).then((result) => {
              if (result.response === 1) {
                store.delete('credentials');
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '완료',
                  message: '로그인 정보가 삭제되었습니다.'
                });
              }
            });
          }
        },
        { type: 'separator' },
        {
          label: '종료',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: '도움말',
      submenu: [
        {
          label: '정보',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '고려대학교 수강신청 앱',
              message: '고려대학교 수강신청 자동화 앱',
              detail: '버전: 1.0.0\n자동 로그인 및 서버시간 표시 기능을 제공합니다.'
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // 우클릭 컨텍스트 메뉴 추가
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: '로그인 정보 수정',
        click: () => {
          createLoginWindow();
        }
      },
      { type: 'separator' },
      {
        label: '새로고침',
        click: () => {
          mainWindow.reload();
        }
      }
    ]);
    contextMenu.popup();
  });

  // 수강신청 사이트 로드
  mainWindow.loadURL('https://sugang.korea.ac.kr/');

  // 개발자 도구 (개발 중에만 사용)
  // mainWindow.webContents.openDevTools();

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // iframe 내부의 로그인 폼 감지 및 자동 로그인
  mainWindow.webContents.on('did-finish-load', () => {
    // 페이지 로드 후 약간의 지연을 두고 설정
    setTimeout(() => {
      setupAutoLogin();
      setupServerTimeModal();
    }, 500);
  });

  // iframe 로드 완료 감지
  mainWindow.webContents.on('dom-ready', () => {
    console.log('DOM 로드 완료');
  });
}

function createLoginWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    try {
      // 창이 없으면 새로 만들고 로드 완료 후 다시 시도
      if (!mainWindow) {
        createMainWindow();
      }
    } catch (_) {
      return;
    }
    return;
  }
  // 메인 창에 직접 모달 주입
  mainWindow.webContents.executeJavaScript(`
    (async function() {
      // 기존 모달 제거
      const existingModal = document.getElementById('login-modal-overlay');
      if (existingModal) {
        existingModal.remove();
      }

      // 폰트 추가
      if (!document.querySelector('link[href*="pretendard"]')) {
        const fontLink = document.createElement('link');
        fontLink.rel = 'stylesheet';
        fontLink.href = 'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css';
        document.head.appendChild(fontLink);
      }

      // 로고 경로 로드
      let logoSrc = '';
      let sloganSrc = '';
      try { logoSrc = await window.electronAPI.getAssetPath('ku-logo.png'); } catch (_) {}
      try { sloganSrc = await window.electronAPI.getAssetPath('kuni120-1-hd.png'); } catch (_) {}

      // 모달 오버레이 생성
      const overlay = document.createElement('div');
      overlay.id = 'login-modal-overlay';
      overlay.style.cssText = \`
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(10px);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2147483646;
        font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
        transition: background 0.25s ease;
      \`;

      // 모달 컨테이너
      const modal = document.createElement('div');
      modal.style.cssText = \`
        background: white;
        border-radius: 8px;
        width: 520px;
        max-width: 90vw;
        border: 1px solid #ddd;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
        overflow: hidden;
        animation: modalSlideIn 0.3s ease-out;
      \`;

      // 애니메이션 스타일 추가
      const style = document.createElement('style');
      style.textContent = \`
        @keyframes modalSlideIn {
          from {
            opacity: 0;
            transform: translateY(-20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes modalSlideOut {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(-10px) scale(0.96);
          }
        }
        
        .modal-header {
          background: #ffffff;
          color: #111827;
          padding: 18px 22px;
          display: flex;
          align-items: center;
          gap: 14px;
        }
        .modal-header img { height: 32px; width: auto; display: block; }
        
        .kupid-logo { font-size: 18px; font-weight: 700; letter-spacing: .5px; margin-left: 2px; }
        
        .header-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-right img { height: 28px; width: auto; display: block; opacity: .98; filter: drop-shadow(0 1px 0 rgba(0,0,0,.05)); }
        
        .slogan { font-size: 10px; opacity: 0.9; margin-top: 5px; }
        
        .modal-content { padding: 26px 28px; }
        
        .form-group {
          margin-bottom: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #333;
        }
        
        .form-group input[type="text"],
        .form-group input[type="password"] {
          width: 100%;
          padding: 12px 16px;
          border: 1px solid #ccc;
          border-radius: 4px;
          font-size: 14px;
          font-family: inherit;
          transition: all 0.2s ease;
          box-sizing: border-box;
        }
        
        .form-group input:focus { outline: none; border-color: #9B1B30; box-shadow: 0 0 0 2px rgba(155, 27, 48, 0.12); }
        
        .checkbox-group {
          margin: 20px 0;
        }
        
        .checkbox-item {
          display: flex;
          align-items: center;
          margin-bottom: 12px;
          font-size: 14px;
        }
        
        .checkbox-item input[type="checkbox"] { margin-right: 10px; width: 16px; height: 16px; accent-color: #9B1B30; }
        
        .btn-container {
          display: flex;
          gap: 10px;
          margin-top: 18px;
        }
        
        .btn {
          flex: 1;
          padding: 12px 16px;
          border: none;
          border-radius: 4px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
        }
        
        .btn-primary { background: #9B1B30; color: white; }
        
        .btn-primary:hover { background: #7a0019; }
        
        .btn-warning { background: #6b7280; color: #fff; }
        
        .btn-warning:hover { background: #4b5563; }
        
        .btn-secondary { background: #f5f5f5; color: #333; border: 1px solid #ddd; }
        
        .btn-secondary:hover {
          background: #e9e9e9;
        }
        
        .error-message {
          color: #C8102E;
          font-size: 12px;
          margin-top: 8px;
          display: none;
        }
        
        .success-message {
          color: #28a745;
          font-size: 12px;
          margin-top: 8px;
          display: none;
        }
      \`;
      document.head.appendChild(style);

      // 모달 HTML 구조
      modal.innerHTML = \`
        <div class="modal-header">
          \${logoSrc ? ('<img src="file://' + logoSrc + '" alt="logo" />') : ''}
          <div class="header-right">\${sloganSrc ? ('<img src="file://' + sloganSrc + '" alt="120th" />') : ''}</div>
        </div>
        
        <div class="modal-content">
          <form id="loginForm">
            <div class="form-group">
              <label for="username">학번</label>
              <input type="text" id="username" name="username" placeholder="아이디를 입력하세요" required>
              <div class="error-message" id="username-error"></div>
            </div>
            
            <div class="form-group">
              <label for="password">비밀번호</label>
              <input type="password" id="password" name="password" placeholder="비밀번호를 입력하세요" required>
              <div class="error-message" id="password-error"></div>
            </div>
            
            <div class="checkbox-group">
              <div class="checkbox-item">
                <input type="checkbox" id="autoLogin" checked>
                <label for="autoLogin">자동 로그인 (정각/30분 시도)</label>
              </div>
              <div class="checkbox-item">
                <input type="checkbox" id="saveInfo" checked>
                <label for="saveInfo">로그인 정보 저장 (이 기기)</label>
              </div>
              <div class="checkbox-item">
                <input type="checkbox" id="autoUpdate">
                <label for="autoUpdate">자동 업데이트</label>
              </div>
            </div>
            
            <div class="btn-container">
              <button type="submit" class="btn btn-primary" id="saveBtn">저장</button>
              <button type="button" class="btn btn-warning" id="deleteBtn">정보 삭제</button>
              <button type="button" class="btn btn-secondary" id="cancelBtn">닫기</button>
            </div>
          </form>
          
          <div class="success-message" id="success-message">로그인 정보가 저장되었습니다!</div>
        </div>
      \`;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // 기존 로그인 정보 불러오기
      window.electronAPI.getCredentials().then(credentials => {
        if (credentials) {
          document.getElementById('username').value = credentials.username || '';
          document.getElementById('password').value = credentials.password || '';
          const autoLoginEl = document.getElementById('autoLogin');
          const saveInfoEl = document.getElementById('saveInfo');
          if (autoLoginEl) autoLoginEl.checked = credentials.autoLogin !== false; // 기본값 true
          if (saveInfoEl) saveInfoEl.checked = credentials.saveInfo !== false; // 기본값 true
        }
      }).catch(error => {
        console.error('기존 로그인 정보 불러오기 실패:', error);
      });

      // 폼 제출 처리
      document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        const autoLogin = document.getElementById('autoLogin').checked;
        const saveInfo = document.getElementById('saveInfo').checked;
        
        if (!username) {
          showError('username-error', '아이디를 입력해주세요.');
          return;
        }
        
        if (!password) {
          showError('password-error', '비밀번호를 입력해주세요.');
          return;
        }

        try {
          await window.electronAPI.saveCredentials({ username, password, autoLogin, saveInfo });
          showSuccess('로그인 정보가 저장되었습니다!');
          
          setTimeout(() => {
            closeOverlay();
          }, 1000);
        } catch (error) {
          showError('username-error', '저장 중 오류가 발생했습니다.');
        }
      });

      // 정보 삭제 버튼
      document.getElementById('deleteBtn').addEventListener('click', async () => {
        try {
          await window.electronAPI.clearCredentials();
          showSuccess('로그인 정보가 삭제되었습니다!');
          document.getElementById('username').value = '';
          document.getElementById('password').value = '';
          
          setTimeout(() => {
            closeOverlay();
          }, 1000);
        } catch (error) {
          showError('username-error', '삭제 중 오류가 발생했습니다.');
        }
      });

      // 취소 버튼
      document.getElementById('cancelBtn').addEventListener('click', () => {
        closeOverlay();
      });

      // 오버레이 클릭 시 닫기
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          closeOverlay();
        }
      });

      function showError(elementId, message) {
        const errorElement = document.getElementById(elementId);
        errorElement.textContent = message;
        errorElement.style.display = 'block';
        
        setTimeout(() => {
          errorElement.style.display = 'none';
        }, 3000);
      }

      function showSuccess(message) {
        const successElement = document.getElementById('success-message');
        successElement.textContent = message;
        successElement.style.display = 'block';
        
        document.getElementById('saveBtn').disabled = true;
        document.getElementById('saveBtn').textContent = '저장됨';
      }

      function closeOverlay() {
        try {
          overlay.style.background = 'rgba(0,0,0,0)';
          modal.style.animation = 'modalSlideOut 0.22s ease-in forwards';
          setTimeout(() => { overlay.remove(); }, 220);
        } catch (_) { overlay.remove(); }
      }

      // 입력 필드 포커스 시 에러 메시지 숨김
      document.getElementById('username').addEventListener('focus', () => {
        document.getElementById('username-error').style.display = 'none';
      });

      document.getElementById('password').addEventListener('focus', () => {
        document.getElementById('password-error').style.display = 'none';
      });

      console.log('로그인 모달이 메인 창에 주입되었습니다.');
    })();
  `).catch(err => {
    console.error('로그인 모달 주입 실패:', err);
  });
}

function setupServerTimeModal() {
  console.log('서버 시간 모달 설정 시작');
  
  // 간단한 서버 시간 모달 주입
  const injectModal = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    const script = `
      (function() {
        try {
          // 기존 모달 제거
          const existing = document.getElementById('server-time-modal');
          if (existing) existing.remove();
          
          // 폰트 추가
          if (!document.querySelector('link[href*="JetBrains+Mono"]')) {
            const fontLink = document.createElement('link');
            fontLink.rel = 'stylesheet';
            fontLink.href = 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&display=swap';
            document.head.appendChild(fontLink);
          }
          
          // 모달 생성
          const modal = document.createElement('div');
          modal.id = 'server-time-modal';
                     modal.innerHTML = \`
             <div id="stm-container" style="
               position: fixed;
               bottom: 20px;
               right: 20px;
               background: rgba(20, 20, 20, 0.9);
               color: #ffffff;
               padding: 15px 20px;
               border-radius: 10px;
               font-family: 'Pretendard', sans-serif;
               z-index: 2147483647;
               min-width: 200px;
               backdrop-filter: blur(10px);
               border: 1px solid rgba(255, 255, 255, 0.08);
               box-shadow: 
                 0 8px 32px rgba(0, 0, 0, 0.3),
                 0 0 0 1px rgba(255, 255, 255, 0.1),
                 inset 0 1px 0 rgba(255, 255, 255, 0.2);
               overflow: hidden;
             ">
               <div style="
                 position: absolute;
                 top: 0;
                 left: 0;
                 right: 0;
                 height: 1px;
                 background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.15), transparent);
               "></div>
               <div style="
                 position: absolute;
                 top: 0;
                 left: 0;
                 right: 0;
                 bottom: 0;
                 background: radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.06) 0%, transparent 50%);
                 pointer-events: none;
               "></div>
               <div style="font-size: 11px; margin-bottom: 10px; color: #C8102E; text-align: center; font-weight: 700; letter-spacing: 0.5px;">서버시간</div>
               <div id="time-display" style="
                 font-family: 'JetBrains Mono', monospace;
                 font-size: 14px;
                 font-weight: 400;
                 color: rgba(255, 255, 255, 0.95);
                 margin-bottom: 8px;
                 text-align: center;
                 letter-spacing: 1px;
               ">--:--:--.000</div>
               <div id="date-display" style="
                 font-size: 11px;
                 color: rgba(255, 255, 255, 0.6);
                 text-align: center;
                 font-weight: 400;
                 letter-spacing: 0.3px;
               ">0000.00.00</div>
             </div>
           \`;
          
          document.body.appendChild(modal);
          
          // 시간 업데이트 함수
          function updateTime() {
            const now = new Date();
            const timeDisplay = document.getElementById('time-display');
            const dateDisplay = document.getElementById('date-display');
            
                         if (timeDisplay) {
               const timeStr = now.toLocaleTimeString('ko-KR', {
                 hour: '2-digit',
                 minute: '2-digit',
                 second: '2-digit',
                 hour12: false
               });
               const ms = now.getMilliseconds().toString().padStart(3, '0');
               timeDisplay.textContent = timeStr + '.' + ms;
             }
            
            if (dateDisplay) {
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              dateDisplay.textContent = year + '.' + month + '.' + day;
            }
          }
          
          // 초기 업데이트 및 주기적 업데이트
          updateTime();
          setInterval(updateTime, 50); // 50ms마다 업데이트 (20fps)

          // 동적 색상 전환 제거, 다크 배경/라이트 텍스트 고정
 
          console.log('서버 시간 모달 생성 완료');
        } catch (e) {
          console.error('서버 시간 모달 생성 실패:', e);
        }
      })();
    `;
    
    mainWindow.webContents.executeJavaScript(script).catch(err => {
      console.error('서버 시간 모달 주입 실패:', err);
    });
  };
  
  // 페이지 로드 후 주입
  setTimeout(injectModal, 2000);
  
  // 주기적으로 확인 및 재주입
  setInterval(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    
    mainWindow.webContents.executeJavaScript(`
      document.getElementById('server-time-modal') ? true : false
    `).then(exists => {
      if (!exists) {
        console.log('서버 시간 모달 재주입');
        injectModal();
      }
    }).catch(() => {});
  }, 5000);
}

function setupAutoLogin() {
  // 저장된 로그인 정보 확인
  const savedCredentials = store.get('credentials');
  
  if (!savedCredentials) {
    // 최초 실행시 로그인 정보 입력 창 표시
    createLoginWindow();
    return;
  }
 
  // 즉시 한 번 프리필 시도
  waitForIframeAndPrefill(savedCredentials, null);
 
  // 자동 로그인 스케줄러 설정(정각/30분에만 실행)
  if (savedCredentials.autoLogin !== false) {
    scheduleAutoLogin();
  } else {
    console.log('자동 로그인이 비활성화되어 있어 스케줄러를 시작하지 않습니다.');
  }
}

function scheduleAutoLogin() {
  const now = new Date();
  const minutes = now.getMinutes();
  const seconds = now.getSeconds();
  
  // 다음 정각 또는 30분까지 대기 시간 계산
  let waitMinutes = 0;
  if (minutes < 30) {
    waitMinutes = 30 - minutes;
  } else {
    waitMinutes = 60 - minutes;
  }
  
  // 정확한 시간에 시작
  const waitSeconds = waitMinutes * 60 - seconds;
  
  console.log(`${waitSeconds}초 후 자동 로그인 스케줄 준비 (${waitMinutes}분 ${seconds}초 대기, 정각/30분에 맞춤)`);
  
  // 타겟 시간 계산 (다음 00 또는 30분, 초 0)
  const targetTime = new Date(now.getTime() + waitSeconds * 1000);
  targetTime.setSeconds(0, 0);

  // 클릭 타이머는 목표 90초 전부터만 돌도록 설정
  const clickerLeadMs = 90 * 1000;
  const startClickerDelayMs = Math.max(targetTime.getTime() - Date.now() - clickerLeadMs, 0);
  setTimeout(() => {
    startTimedClicker(targetTime.getTime());
  }, startClickerDelayMs);

  // 목표 1.2초 전에 프리필 재시도 (폼이 초기화된 경우 대비)
  const prefillRefreshLeadMs = 1200;
  const prefillRefreshDelayMs = Math.max(targetTime.getTime() - Date.now() - prefillRefreshLeadMs, 0);
  setTimeout(() => {
    const credentials = store.get('credentials');
    if (credentials) {
      console.log('타겟 직전 프리필 재시도');
      waitForIframeAndPrefill(credentials, null);
    }
  }, prefillRefreshDelayMs);

  // 30분마다 반복 스케줄 설정
  setTimeout(() => {
    console.log('30분 주기 자동 로그인 스케줄 준비');
    setInterval(() => {
      const now2 = new Date();
      const nextTarget = new Date(now2);
      nextTarget.setSeconds(0, 0);
      if (now2.getMinutes() < 30) {
        nextTarget.setMinutes(30);
      } else {
        nextTarget.setMinutes(0);
        nextTarget.setHours(now2.getHours() + 1);
      }

      const credentials2 = store.get('credentials');

      // 클릭 타이머는 목표 90초 전부터 시작
      const startClickerDelay2 = Math.max(nextTarget.getTime() - Date.now() - clickerLeadMs, 0);
      setTimeout(() => {
        startTimedClicker(nextTarget.getTime());
      }, startClickerDelay2);

      // 목표 1.2초 전 프리필 재시도
      const prefillDelay2 = Math.max(nextTarget.getTime() - Date.now() - prefillRefreshLeadMs, 0);
      setTimeout(() => {
        console.log('주기 타겟 직전 프리필 재시도');
        if (credentials2) {
          waitForIframeAndPrefill(credentials2, null);
        }
      }, prefillDelay2);
    }, 30 * 60 * 1000);
  }, Math.max(targetTime.getTime() - Date.now(), 0));
}

function performAutoLogin() {
  const credentials = store.get('credentials');
  if (!credentials) return;

  console.log('자동 로그인 실행 중...');
  
  // iframe 로드 대기 후 로그인 시도
  waitForIframeAndLogin(credentials);
}

function waitForIframeAndLogin(credentials) {
  let attempts = 0;
  const maxAttempts = 20; // 더 오래, 더 촘촘히 시도
  
  const checkIframe = () => {
    attempts++;
    console.log(`iframe 확인 시도 ${attempts}/${maxAttempts}`);
    
    mainWindow.webContents.executeJavaScript(`
      (function() {
        const mainIframe = document.querySelector('iframe[name="Main"], iframe#Main');
        if (mainIframe && mainIframe.contentDocument && mainIframe.contentDocument.readyState === 'complete') {
          return true;
        }
        return false;
      })();
    `).then((isReady) => {
      if (isReady) {
        console.log('iframe 로드 완료, 로그인 시도');
        executeLogin(credentials);
      } else if (attempts < maxAttempts) {
        setTimeout(checkIframe, 500); // 0.5초 간격으로 더 빠르게 재시도
      } else {
        console.log('iframe 로드 시간 초과');
      }
    }).catch((error) => {
      console.error('iframe 확인 중 오류:', error);
      if (attempts < maxAttempts) {
        setTimeout(checkIframe, 500);
      }
    });
  };
  
  checkIframe();
}

function executeLogin(credentials) {
  
  // 고려대학교 수강신청 사이트 구조에 맞춘 로그인 정보 입력
  mainWindow.webContents.executeJavaScript(`
    (function() {
      try {
        const username = ${JSON.stringify(String(credentials.username || ''))};
        const password = ${JSON.stringify(String(credentials.password || ''))};

        function setValueWithNativeSetter(input, value) {
          try {
            const proto = Object.getPrototypeOf(input);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc && typeof desc.set === 'function') {
              desc.set.call(input, value);
            } else {
              input.value = value;
            }
          } catch (_) { input.value = value; }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        const USERNAME_SELECTORS = [
          'input[name="id"]','input#id','.input-id','input[name="userid"]','input[name="username"]','input[name="student_id"]',
          'input#userId','input#userid','input#loginId','input[type="text"]:not([name="captcha"])'
        ];
        const PASSWORD_SELECTORS = [
          'input[name="pwd"]','input#pwd','.input-pw','input[name="password"]','input[name="passwd"]','input#password','input#passwd','input[type="password"]'
        ];

        function queryFirst(doc, selectors) {
          for (const s of selectors) {
            const el = doc.querySelector(s);
            if (el) return el;
          }
          return null;
        }

        function tryPrefillAndClick(doc) {
          const u = queryFirst(doc, USERNAME_SELECTORS);
          const p = queryFirst(doc, PASSWORD_SELECTORS);
          const btn = doc.querySelector('button#btn-login, .btn-login, button[type="button"], input[type="submit"], button[type="submit"], .btn_login, .login_btn');
          if (u && p) {
            u.focus(); setValueWithNativeSetter(u, username);
            p.focus(); setValueWithNativeSetter(p, password);
            if (btn) {
              try { btn.click(); return true; } catch (_) { const f = btn.closest('form'); if (f) { f.submit(); return true; } }
            } else {
              const f = (u.closest('form') || p.closest('form'));
              if (f) { f.submit(); return true; }
            }
          }
          return false;
        }

        // 1) Main iframe 우선
        const mainIframe = document.querySelector('iframe[name="Main"], iframe#Main');
        if (mainIframe && mainIframe.contentDocument) {
          if (tryPrefillAndClick(mainIframe.contentDocument)) return true;
        }

        // 2) 모든 동일 출처 iframe 시도
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const f of iframes) {
          try {
            if (f.contentDocument && tryPrefillAndClick(f.contentDocument)) return true;
          } catch (e) {}
        }

        // 3) 메인 문서 시도
        if (tryPrefillAndClick(document)) return true;

        console.warn('[로그인] 입력/버튼을 찾지 못했습니다.');
        return false;
      } catch (e) {
        console.error('[로그인] 오류', e);
        return false;
      }
    })();
  `);
}

// 서버시간 가져오기 함수
async function getServerTime() {
  // 1) 대상 사이트 Date 헤더 우선, 2) 네이비즘 보조, 3) 로컬시간
  const fetchedAtMs = Date.now();

  // 시도 1: sugang.korea.ac.kr HEAD 요청으로 Date 헤더 가져오기
  try {
    const headerTime = await new Promise((resolve) => {
      const req = https.request({ hostname: 'sugang.korea.ac.kr', port: 443, path: '/', method: 'HEAD' }, (res) => {
        const dateHeader = res.headers && res.headers['date'];
        if (dateHeader) {
          const ms = new Date(dateHeader).getTime();
          return resolve(Number.isNaN(ms) ? null : ms);
        }
        resolve(null);
      });
      req.on('error', () => resolve(null));
      req.setTimeout(2000, () => { req.destroy(); resolve(null); });
      req.end();
    });
    if (headerTime) {
      return { serverMs: headerTime, fetchedAtMs };
    }
  } catch (_) {}

  // 시도 2: time.navyism.com 파싱 (가능하면)
  try {
    const resMs = await new Promise((resolve) => {
      const options = {
        hostname: 'time.navyism.com',
        port: 443,
        path: '/?host=sugang.korea.ac.kr',
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
        }
      };
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const altMatch = data.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})/);
            if (altMatch) {
              const ms = new Date(altMatch[1].replace(' ', 'T') + 'Z').getTime();
              return resolve(Number.isNaN(ms) ? null : ms);
            }
          } catch {}
          resolve(null);
        });
      });
      req.on('error', () => resolve(null));
      req.setTimeout(2000, () => { req.destroy(); resolve(null); });
      req.end();
    });
    if (resMs) {
      return { serverMs: resMs, fetchedAtMs };
    }
  } catch (_) {}

  // 시도 3: 로컬
  return { serverMs: Date.now(), fetchedAtMs };
}

// IPC 이벤트 핸들러
ipcMain.handle('save-credentials', async (event, credentials) => {
  store.set('credentials', credentials);
  if (credentials && credentials.autoLogin !== false) {
    scheduleAutoLogin();
  } else {
    console.log('자동 로그인이 비활성화 상태로 저장됨. 스케줄러 미시작.');
  }
});

ipcMain.handle('get-credentials', async () => {
  return store.get('credentials');
});

ipcMain.handle('clear-credentials', async () => {
  store.delete('credentials');
});

ipcMain.handle('get-server-time', async () => {
  return await getServerTime();
});

// 애셋 절대경로 전달 (이미지 등)
ipcMain.handle('get-asset-path', async (_e, name) => {
  try {
    // 앱 루트 기준 images 폴더 사용
    const p = path.join(__dirname, 'images', String(name || ''));
    return p;
  } catch (_) {
    return null;
  }
});

app.whenReady().then(createMainWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

// 프리필만 수행하고, 준비되면 콜백 실행
function waitForIframeAndPrefill(credentials, onReady) {
  let attempts = 0;
  const maxAttempts = 40; // 메인 문서 케이스까지 여유 있게 시도
  const checkReady = () => {
    attempts++;
    mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          const mainIframe = document.querySelector('iframe[name="Main"], iframe#Main');
          const iframeReady = !!(mainIframe && mainIframe.contentDocument && mainIframe.contentDocument.readyState === 'complete');
          // 메인 문서의 로그인 요소 존재 여부도 확인 (#id, #pwd)
          const docReady = !!(document.querySelector('input#id, input[name="id"], .input-id') && document.querySelector('input#pwd, input[name="pwd"], .input-pw'));
          return iframeReady || docReady;
        } catch (_) { return false; }
      })();
    `).then((isReady) => {
      if (isReady) {
        // 준비 완료: 실제 값이 채워질 때까지 짧은 주기로 재시도
        let fillAttempts = 0;
        const maxFillAttempts = 40; // 약 10초(250ms * 40)
        const tryFill = () => {
          fillAttempts++;
          executeLoginPrefill(credentials).then((ok) => {
            if (ok) {
              console.log('프리필 성공');
              if (onReady) onReady();
            } else if (fillAttempts < maxFillAttempts) {
              setTimeout(tryFill, 250);
            } else {
              console.warn('프리필 재시도 한도 도달');
              if (onReady) onReady();
            }
          }).catch(() => {
            if (fillAttempts < maxFillAttempts) setTimeout(tryFill, 250);
            else if (onReady) onReady();
          });
        };
        tryFill();
      } else if (attempts < maxAttempts) {
        setTimeout(checkReady, 300);
      } else {
        if (onReady) onReady(); // 그래도 클릭 타이머는 시작
      }
    }).catch(() => {
      if (attempts < maxAttempts) setTimeout(checkReady, 300);
      else if (onReady) onReady();
    });
  };
  checkReady();
}

// 입력값만 미리 채우는 함수
function executeLoginPrefill(credentials) {
  return mainWindow.webContents.executeJavaScript(`
    (function() {
      try {
        const username = ${JSON.stringify(String(credentials.username || ''))};
        const password = ${JSON.stringify(String(credentials.password || ''))};

        function setValueWithNativeSetter(input, value) {
          try {
            const proto = Object.getPrototypeOf(input);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
            if (desc && typeof desc.set === 'function') {
              desc.set.call(input, value);
            } else {
              input.value = value;
            }
          } catch (_) { input.value = value; }
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          input.dispatchEvent(new Event('blur', { bubbles: true }));
        }

        const USERNAME_SELECTORS = [
          'input[name="id"]','input#id','.input-id','input[name="userid"]','input[name="username"]','input[name="student_id"]',
          'input#userId','input#userid','input#loginId','input[type="text"]:not([name="captcha"])'
        ];
        const PASSWORD_SELECTORS = [
          'input[name="pwd"]','input#pwd','.input-pw','input[name="password"]','input[name="passwd"]','input#password','input#passwd','input[type="password"]'
        ];

        function queryFirst(doc, selectors) {
          for (const s of selectors) {
            const el = doc.querySelector(s);
            if (el) return el;
          }
          return null;
        }

        function tryPrefillInDoc(doc) {
          const u = queryFirst(doc, USERNAME_SELECTORS);
          const p = queryFirst(doc, PASSWORD_SELECTORS);
          if (u && p) {
            console.log('[프리필] 입력 필드 발견', u, p);
            u.focus(); setValueWithNativeSetter(u, username);
            p.focus(); setValueWithNativeSetter(p, password);
            return true;
          }
          return false;
        }

        // 1) name="Main"/id="Main" 우선
        const mainIframe = document.querySelector('iframe[name="Main"], iframe#Main');
        if (mainIframe && mainIframe.contentDocument) {
          if (tryPrefillInDoc(mainIframe.contentDocument)) return true;
        }

        // 2) 동일 출처 iframe 전부 시도
        const iframes = Array.from(document.querySelectorAll('iframe'));
        for (const f of iframes) {
          try {
            if (f.contentDocument && tryPrefillInDoc(f.contentDocument)) return true;
          } catch (e) { /* cross-origin 무시 */ }
        }

        // 3) 메인 문서에서 시도
        if (tryPrefillInDoc(document)) return true;

        console.warn('[프리필] 입력 필드를 찾지 못했습니다.');
        return false;
      } catch (e) {
        console.error('[프리필] 오류', e);
        return false;
      }
    })();
  `);
}

// 버튼 클릭만 수행
function clickLoginButtonOnly() {
  return mainWindow.webContents.executeJavaScript(`
    (function() {
      function tryClick(doc) {
        const loginButton = doc.querySelector('button#btn-login, .btn-login, button[type="button"], input[type="submit"], button[type="submit"], .btn_login, .login_btn');
        if (loginButton) {
          try { loginButton.click(); return true; } catch (_) {}
          const form = loginButton.closest('form');
          if (form) { form.submit(); return true; }
        }
        return false;
      }
      const mainIframe = document.querySelector('iframe[name="Main"], iframe#Main');
      if (mainIframe && mainIframe.contentDocument) {
        if (tryClick(mainIframe.contentDocument)) return true;
      }
      return tryClick(document);
    })();
  `);
}

// 타이밍에 맞춰 클릭 시도
function startTimedClicker(targetMs) {
  const start = Date.now();
  const interval = setInterval(() => {
    const now = new Date();
    const minutes = now.getMinutes();
    const seconds = now.getSeconds();
    const ms = now.getMilliseconds();

    // 29분 또는 59분이고, 59초, 밀리초가 800~899 사이일 때 트리거
    const isTargetMinute = (minutes % 30) === 29; // 29 또는 59
    if (isTargetMinute && seconds === 59 && ms >= 800 && ms < 900) {
      console.log('29/59분 59초 800ms대 조건 충족, 로그인 클릭 시도');
      clickLoginButtonOnly().finally(() => clearInterval(interval));
    }

    // 안전장치: 2분 넘으면 중단
    if (Date.now() - start > 120000) clearInterval(interval);
  }, 5);
}
