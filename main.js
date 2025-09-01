const { app, BrowserWindow, ipcMain, dialog, screen, Menu, shell, nativeImage } = require('electron');
const path = require('path');
const Store = require('electron-store');
const https = require('https');
const fs = require('fs');
const os = require('os');

// [최후의 수단] 샌드박스/프로파일러/GPU 관련 스위치 적용 (개발 모드에서만)
try {
  if (!app.isPackaged) {
    app.commandLine.appendSwitch('no-sandbox');
    app.commandLine.appendSwitch('disable-features', 'ProcessReuse');
    app.commandLine.appendSwitch('disable-gpu');
  } else {
    // 배포 빌드에서는 안전한 API만 사용
    app.disableHardwareAcceleration();
    // V8 관련 취약 구간 우회 (패키지에서만): JIT/Wasm 비활성화
    app.commandLine.appendSwitch('js-flags', '--jitless --noexpose_wasm');
    app.commandLine.appendSwitch('disable-features', 'WebAssemblyCSP,SharedArrayBuffer,V8VmFuture');
  }
} catch (e) {
  console.error('Failed to apply command line switches:', e);
}

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
      allowRunningInsecureContent: true,
      experimentalFeatures: false,
      webgl: false,
      plugins: false,
      sandbox: false
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
                store.delete('firstRun'); // firstRun 플래그도 함께 삭제
                dialog.showMessageBox(mainWindow, {
                  type: 'info',
                  title: '완료',
                  message: '로그인 정보가 삭제되었습니다. 다음 실행 시 로그인 정보를 다시 입력해주세요.'
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
      label: '업데이트',
      submenu: [
        {
          label: '업데이트 확인',
          click: () => {
            checkForUpdatesWithGithub();
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

  // 렌더링 지연/이벤트 누락 시 강제 표시 (보수적 타임아웃)
  setTimeout(() => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        mainWindow.show();
      }
    } catch (_) {}
  }, 5000);

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

      // 모달 오버레이 생성 (성능 최적화)
      const overlay = document.createElement('div');
      overlay.id = 'login-modal-overlay';
      overlay.style.cssText = \`
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.6);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 2147483646;
        font-family: "Pretendard", -apple-system, BlinkMacSystemFont, system-ui, Roboto, "Helvetica Neue", "Segoe UI", "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif;
        opacity: 0;
        transition: opacity 0.2s ease;
      \`;

      // 모달 컨테이너 (성능 최적화)
      const modal = document.createElement('div');
      modal.style.cssText = \`
        background: white;
        border-radius: 8px;
        width: 520px;
        max-width: 90vw;
        border: 1px solid #ddd;
        box-shadow: 0 8px 25px rgba(0, 0, 0, 0.25);
        overflow: hidden;
        transform: translateY(-20px) scale(0.95);
        opacity: 0;
        transition: all 0.25s ease;
      \`;

      // 성능 최적화된 스타일 추가
      const style = document.createElement('style');
      style.textContent = \`
        .login-modal-overlay {
          will-change: opacity;
        }
        .login-modal {
          will-change: transform, opacity;
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
          transition: border-color 0.15s ease, box-shadow 0.15s ease;
          box-sizing: border-box;
          background: #fff;
        }
        
        .form-group input:focus { 
          outline: none; 
          border-color: #9B1B30; 
          box-shadow: 0 0 0 2px rgba(155, 27, 48, 0.12); 
        }
        
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
          transition: background-color 0.15s ease, transform 0.1s ease;
          font-family: inherit;
          user-select: none;
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
        
        .login-header {
          text-align: center;
          margin-bottom: 24px;
        }
        
        .login-header h2 {
          margin: 0 0 8px 0;
          color: #111827;
          font-size: 20px;
          font-weight: 600;
        }
        
        .login-header p {
          margin: 0;
          color: #6b7280;
          font-size: 14px;
          line-height: 1.5;
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
          <div class="login-header">
            <h2>로그인 정보 설정</h2>
            <p>수강신청 자동 로그인을 위해 학번과 비밀번호를 입력해주세요.</p>
          </div>
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

      overlay.className = 'login-modal-overlay';
      modal.className = 'login-modal';
      overlay.appendChild(modal);
      document.body.appendChild(overlay);
      
      // 애니메이션 시작 (다음 프레임에서)
      requestAnimationFrame(() => {
        overlay.style.opacity = '1';
        modal.style.transform = 'translateY(0) scale(1)';
        modal.style.opacity = '1';
      });

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
          
          // 저장 성공 후 1초 뒤에 애니메이션과 함께 닫기
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
          
          // 삭제 성공 후 1초 뒤에 애니메이션과 함께 닫기
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
          // 오버레이 페이드 아웃
          overlay.style.opacity = '0';
          
          // 모달 슬라이드 아웃
          modal.style.transform = 'translateY(-20px) scale(0.95)';
          modal.style.opacity = '0';
          
          // 애니메이션 완료 후 요소 제거
          setTimeout(() => { 
            if (overlay && overlay.parentNode) {
              overlay.remove(); 
            }
          }, 250);
        } catch (_) { 
          if (overlay && overlay.parentNode) {
            overlay.remove(); 
          }
        }
      }

      // 입력 필드 포커스 시 에러 메시지 숨김 (성능 최적화)
      const usernameInput = document.getElementById('username');
      const passwordInput = document.getElementById('password');
      const usernameError = document.getElementById('username-error');
      const passwordError = document.getElementById('password-error');
      
      usernameInput.addEventListener('focus', () => {
        usernameError.style.display = 'none';
      });

      passwordInput.addEventListener('focus', () => {
        passwordError.style.display = 'none';
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
  // 배포 빌드에서는 저장된 로그인 정보 완전 초기화 (개발자 정보 제거)
  if (app.isPackaged) {
    const isFirstRun = !store.has('firstRun');
    if (isFirstRun) {
      // 최초 실행 시 기존 로그인 정보 완전 삭제
      store.delete('credentials');
      store.set('firstRun', true);
      console.log('배포 앱 최초 실행: 기존 로그인 정보 초기화됨');
    }
  }

  // 저장된 로그인 정보 확인
  const savedCredentials = store.get('credentials');
  
  if (!savedCredentials) {
    // 로그인 정보가 없으면 로그인 정보 입력 창 표시
    console.log('로그인 정보가 없습니다. 로그인 정보 입력 창을 표시합니다.');
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

// GitHub API 기반 업데이트 확인 및 설치 (개선된 버전)
function checkForUpdatesWithGithub() {
  const repoOwner = 'BBIYAKYEE7';
  const repoName = 'sugang';
  const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/releases/latest`;

  const requestOptions = {
    headers: {
      'User-Agent': 'sugang-app-updater',
      'Accept': 'application/vnd.github+json'
    }
  };

  // 현재 OS와 아키텍처 감지
  const currentPlatform = process.platform;
  const currentArch = process.arch;
  
  let osName, archName;
  if (currentPlatform === 'darwin') {
    osName = 'mac';
    archName = currentArch === 'arm64' ? 'arm64' : 'x64';
  } else if (currentPlatform === 'win32') {
    osName = 'win';
    archName = currentArch === 'arm64' ? 'arm64' : 'x64';
  } else if (currentPlatform === 'linux') {
    osName = 'linux';
    archName = currentArch === 'arm64' ? 'arm64' : 'x64';
  } else {
    dialog.showErrorBox('업데이트', '지원되지 않는 운영체제입니다.');
    return;
  }

  // 사전 알림 팝업 제거 (조용히 진행)

  https.get(apiUrl, requestOptions, (res) => {
    let data = '';
    res.on('data', (chunk) => (data += chunk));
    res.on('end', async () => {
      try {
        console.log('GitHub API 응답:', data);
        const release = JSON.parse(data);
        
        if (!release) {
          dialog.showErrorBox('업데이트', '릴리스 정보를 찾을 수 없습니다.');
          return;
        }
        
        if (!release.assets || release.assets.length === 0) {
          dialog.showErrorBox('업데이트', '릴리스에 다운로드 파일이 없습니다.');
          return;
        }
        
        console.log('릴리스 정보:', {
          tag_name: release.tag_name,
          name: release.name,
          body: release.body,
          assets_count: release.assets.length,
          assets: release.assets.map(a => a.name)
        });

        // 현재 버전과 최신 버전 비교
        const currentVersion = require('./package.json').version;
        const latestVersion = String(release.tag_name || '').replace(/^v/i, '');
        const normalize = (v) => v.replace(/^v/i, '').split(/[.-]/).map(x=>isNaN(+x)?x:+x);
        const cmp = (a,b) => { for (let i=0;i<Math.max(a.length,b.length);i++){ const x=a[i]||0, y=b[i]||0; if (x===y) continue; return x>y?1:-1;} return 0; };
        const isLatest = cmp(normalize(currentVersion), normalize(latestVersion)) >= 0;

        if (isLatest) {
          // 최신 버전 안내 팝업
          let iconPath = null;
          try { iconPath = path.join(__dirname, 'images', 'logo.png'); } catch(_) {}
          const iconImg = iconPath ? nativeImage.createFromPath(iconPath) : undefined;
          await dialog.showMessageBox(mainWindow, {
            type: 'info',
            title: '최신 버전입니다!',
            message: '최신 버전입니다!',
            detail: `현재 버전 v${currentVersion}이(가) 최신 버전입니다.`,
            icon: iconImg,
            buttons: ['확인'],
            defaultId: 0
          });
          return;
        }

        // 현재 시스템에 맞는 설치파일 찾기
        const expectedNamePrefix = `Setup-${osName}-${archName}`;
        const asset = release.assets.find((a) => a.name && a.name.startsWith(expectedNamePrefix));
        
        if (!asset) {
          // 현재 시스템용 파일이 없으면 수동 선택 옵션 제공
          const availableAssets = release.assets
            .filter(a => a.name && a.name.startsWith('Setup-'))
            .map(a => a.name);
          
          const { response } = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            buttons: ['수동 선택', '취소'],
            defaultId: 0,
            title: '업데이트 파일 없음',
            message: `현재 시스템(${osName} ${archName})용 설치파일을 찾을 수 없습니다.`,
            detail: `사용 가능한 파일:\n${availableAssets.join('\n')}`
          });
          
          if (response === 0) {
            // 수동 선택 로직
            const archChoices = [
              { label: 'Windows x64', os: 'win', arch: 'x64' },
              { label: 'Windows arm64', os: 'win', arch: 'arm64' },
              { label: 'macOS x64', os: 'mac', arch: 'x64' },
              { label: 'macOS arm64', os: 'mac', arch: 'arm64' },
              { label: 'Linux x64', os: 'linux', arch: 'x64' },
              { label: 'Linux arm64', os: 'linux', arch: 'arm64' }
            ];

            const { response: manualResponse } = await dialog.showMessageBox(mainWindow, {
              type: 'question',
              buttons: archChoices.map((c) => c.label).concat('취소'),
              cancelId: archChoices.length,
              defaultId: 0,
              title: '수동 선택',
              message: '다운로드할 OS/아키텍처를 선택하세요.'
            });
            
            if (manualResponse === archChoices.length) return;
            
            const choice = archChoices[manualResponse];
            const manualAsset = release.assets.find((a) => a.name && a.name.startsWith(`Setup-${choice.os}-${choice.arch}`));
            
            if (!manualAsset) {
              dialog.showErrorBox('업데이트', `선택한 아키텍처의 설치파일을 찾을 수 없습니다.`);
              return;
            }
            
            await downloadAndInstall(manualAsset, release);
            return;
          } else {
            return;
          }
        }

        // 네이티브 대화상자 대신 커스텀 모달 창으로 표시(가로폭 넓게)
        openUpdateWindow(release, asset, osName, archName).catch((e) => {
          console.error('업데이트 창 표시 실패:', e);
        });
        // response === 2는 건너뛰기
        
      } catch (e) {
        dialog.showErrorBox('업데이트 오류', e.message);
      }
    });
  }).on('error', (err) => {
    dialog.showErrorBox('네트워크 오류', err.message);
  });
}

// 업데이트 커스텀 창 (넓은 레이아웃)
async function openUpdateWindow(release, asset, osName, archName) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const versionNow = require('./package.json').version;
  const body = (release.body || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const script = "(() => {\n"
  + "  try {\n"
  + "    const prev = document.getElementById('update-modal-overlay');\n"
  + "    if (prev) prev.remove();\n"
  + "    window.__UPDATE_ACTION__ = null;\n"
  + "    const overlay = document.createElement('div');\n"
  + "    overlay.id = 'update-modal-overlay';\n"
  + "    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0,0,0,.55); display: flex; align-items: center; justify-content: center; z-index: 2147483646; opacity: 0; transition: opacity .18s ease; font-family: -apple-system, BlinkMacSystemFont, system-ui, Segoe UI, Roboto, Helvetica, Arial, sans-serif;';\n"
  + "    const modal = document.createElement('div');\n"
  + "    modal.style.cssText = 'width: min(900px, 92vw); max-height: min(80vh, 780px); background: #111827; color: #e5e7eb; border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,.45); display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; transform: translateY(12px); opacity: .98; transition: transform .2s ease;';\n"
  + "    const header = document.createElement('div');\n"
  + "    header.style.cssText = 'padding: 16px 20px; background: #0b1220; border-bottom: 1px solid rgba(255,255,255,.06); display:flex; align-items:center; gap:12px;';\n"
  + `    header.innerHTML = "<div style=\\"font-weight:700\\">업데이트 가능: ${release.tag_name}</div><div style=\\"margin-left:auto; font-size:12px; opacity:.7\\">현재 버전 ${versionNow} · 대상 ${osName} ${archName}</div>";\n`
  + "    const content = document.createElement('div');\n"
  + "    content.style.cssText = 'padding: 16px 20px; overflow: auto;';\n"
  + "    const note = document.createElement('div');\n"
  + "    note.style.cssText = 'white-space: pre-wrap; line-height:1.5; font-size:13px; word-break: break-word;';\n"
  + `    note.innerHTML = '${body.replace(/'/g, "\\'")}';\n`
  + "    content.appendChild(note);\n"
  + "    const footer = document.createElement('div');\n"
  + "    footer.style.cssText = 'padding: 12px 16px; background:#0b1220; border-top:1px solid rgba(255,255,255,.06); display:flex; gap:10px; position:sticky; bottom:0;';\n"
  + "    const primary = document.createElement('button');\n"
  + "    primary.textContent = '지금 업데이트';\n"
  + "    primary.style.cssText = 'flex:0 0 auto; padding:10px 14px; border-radius:8px; background:#C8102E; color:#fff; border:none; font-weight:700; cursor:pointer;';\n"
  + "    const later = document.createElement('button');\n"
  + "    later.textContent = '나중에';\n"
  + "    later.style.cssText = 'flex:0 0 auto; padding:10px 14px; border-radius:8px; background:#374151; color:#fff; border:none; font-weight:600; cursor:pointer;';\n"
  + "    const skip = document.createElement('button');\n"
  + "    skip.textContent = '건너뛰기';\n"
  + "    skip.style.cssText = 'margin-left:auto; flex:0 0 auto; padding:10px 14px; border-radius:8px; background:#1f2937; color:#9ca3af; border:1px solid #374151; cursor:pointer;';\n"
  + "    footer.appendChild(primary);\n"
  + "    footer.appendChild(later);\n"
  + "    footer.appendChild(skip);\n"
  + "    modal.appendChild(header);\n"
  + "    modal.appendChild(content);\n"
  + "    modal.appendChild(footer);\n"
  + "    overlay.appendChild(modal);\n"
  + "    document.body.appendChild(overlay);\n"
  + "    requestAnimationFrame(() => { overlay.style.opacity = '1'; modal.style.transform = 'translateY(0)'; });\n"
  + "    function close() { overlay.style.opacity = '0'; setTimeout(()=> overlay.remove(), 160); }\n"
  + "    overlay.addEventListener('click', (e)=>{ if(e.target===overlay) close(); });\n"
  + "    primary.addEventListener('click', () => { window.__UPDATE_ACTION__ = 'now'; close(); });\n"
  + "    later.addEventListener('click', () => { window.__UPDATE_ACTION__ = 'later'; close(); });\n"
  + "    skip.addEventListener('click', () => { window.__UPDATE_ACTION__ = 'skip'; close(); });\n"
  + "    return true;\n"
  + "  } catch(e) { console.error(e); return false; }\n"
  + "})()";
  
  await mainWindow.webContents.executeJavaScript(script);
  
  // 액션 수신(폴링)
  async function waitForAction(timeoutMs) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const val = await mainWindow.webContents.executeJavaScript('window.__UPDATE_ACTION__ || null').catch(()=>null);
      if (val) return val;
      await new Promise(r => setTimeout(r, 200));
    }
    return 'skip';
  }
  const action = await waitForAction(120000);

  if (action === 'now') {
    await downloadAndInstall(asset, release);
  } else if (action === 'later') {
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      dialog.showMessageBox(mainWindow, { type: 'info', message: '업데이트 알림', detail: '1시간이 지났습니다. 업데이트를 다시 확인하시겠습니까?' });
    }, 60 * 60 * 1000);
  }
}

// 다운로드 및 설치 함수
async function downloadAndInstall(asset, release) {
  const downloadUrl = asset.browser_download_url;
  const tmpDir = app.getPath('temp');
  const outPath = path.join(tmpDir, asset.name);

  // 다운로드 진행률 표시
  const progressDialog = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['취소'],
    defaultId: 0,
    title: '다운로드 중',
    message: `${asset.name} 다운로드 중...`,
    detail: '잠시만 기다려주세요.'
  });

  const file = fs.createWriteStream(outPath);
  
  https.get(downloadUrl, (downloadRes) => {
    if (downloadRes.statusCode >= 300 && downloadRes.statusCode < 400 && downloadRes.headers.location) {
      // GitHub S3 리디렉션 처리
      https.get(downloadRes.headers.location, (redirRes) => redirRes.pipe(file));
    } else {
      downloadRes.pipe(file);
    }
    
    file.on('finish', () => {
      file.close(() => {
        dialog.showMessageBox(mainWindow, {
          type: 'info',
          buttons: ['지금 설치', '폴더 보기', '닫기'],
          defaultId: 0,
          title: '다운로드 완료',
          message: `${asset.name} 다운로드가 완료되었습니다.`,
          detail: outPath
        }).then(({ response }) => {
          if (response === 0) {
            shell.openPath(outPath);
            // 설치 후 앱 종료
            setTimeout(() => {
              app.quit();
            }, 2000);
          } else if (response === 1) {
            shell.showItemInFolder(outPath);
          }
        });
      });
    });
  }).on('error', (err) => {
    dialog.showErrorBox('다운로드 실패', err.message);
  });
}
