"""One WebView2 test host uses the real frontend account/module bridge."""
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import threading
import time

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
import pytest
import uvicorn

from app.api.routes.auth import router as auth_router
from app.core.config import settings

ROOT=Path(__file__).resolve().parents[2]
PS=shutil.which('powershell.exe')
NODE=shutil.which('node.exe') or shutil.which('node')
pytestmark=pytest.mark.skipif(not PS or not NODE,reason='Windows WebView2 required')
STATIONS=json.loads((ROOT/'tools/desktop-client/workstations.json').read_text(encoding='utf-8'))


@pytest.fixture(scope='module')
def test_bundle(tmp_path_factory):
    root=tmp_path_factory.mktemp('desktop-test-terminal')
    output=root/'client'
    result=subprocess.run([PS,'-NoProfile','-ExecutionPolicy','Bypass','-File',str(ROOT/'scripts/build_desktop_client.ps1'),
                           '-OutputDirectory',str(output),'-Module','test','-Offline'],capture_output=True,timeout=45)
    assert result.returncode == 0,result.stdout+result.stderr
    entry=root/'bridge-entry.js'
    entry.write_text('import {installTestClientNavigation} from '+json.dumps((ROOT/'frontend/src/lib/testClientNavigation.js').as_posix())+';\n'
                     'import {requestDesktopZoom,subscribeDesktopZoom} from '+json.dumps((ROOT/'frontend/src/lib/desktopZoom.js').as_posix())+';\n'
                     'import {loginWithCredentials,readAuthSession,switchSessionModule} from '+json.dumps((ROOT/'frontend/src/auth.js').as_posix())+';\n'+'''
        (async()=>{
          if(window.fixtureLogin)await loginWithCredentials(window.fixtureUser,window.fixturePassword,'central');
          window.zoomState=null;subscribeDesktopZoom(value=>{window.zoomState=value;});
          window.requestFixtureZoom=requestDesktopZoom;requestDesktopZoom('get');
          installTestClientNavigation({readSession:readAuthSession,switchSessionModule,router:{push:async(target)=>{
            const path=typeof target==='string'?target:target.path+'?'+new URLSearchParams(target.query);
            history.pushState({},'',path);document.title='switched:'+path;
          }}});
          document.title='test-bridge-ready';
        })().catch(()=>{document.title='bridge-error';});
    ''',encoding='utf-8')
    compiled=root/'bridge.js'
    script="require('esbuild').buildSync("+json.dumps(dict(entryPoints=[str(entry)],bundle=True,format='iife',outfile=str(compiled),define={'import.meta.env':'{}'}))+')'
    result=subprocess.run([NODE,'-e',script],cwd=ROOT/'frontend',capture_output=True,timeout=20)
    assert result.returncode == 0,result.stdout+result.stderr
    return output/'MES综合测试终端.exe',compiled.read_text(encoding='utf-8')


@pytest.fixture
def test_site(test_bundle):
    app=FastAPI();app.include_router(auth_router)
    login=[False]
    @app.get('/{path:path}')
    def page(path):
        options='window.fixtureLogin='+json.dumps(login[0])+';window.fixtureUser='+json.dumps(settings.DEMO_USER)+';window.fixturePassword='+json.dumps(settings.DEMO_PASSWORD)+';'
        return HTMLResponse('<html data-theme="light"><head><title>starting</title></head><body style="min-height:5000px">Isolated desktop fixture<input id="zoom-focus" aria-label="Zoom input focus"><script>'+options+test_bundle[1]+'</script></body></html>')
    sock=socket.socket();sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
    server=uvicorn.Server(uvicorn.Config(app,host='127.0.0.1',port=port,log_level='error',lifespan='off'))
    thread=threading.Thread(target=lambda:server.run(sockets=[sock]),daemon=True);thread.start()
    deadline=time.monotonic()+10
    while not server.started:
        assert time.monotonic()<deadline;time.sleep(.05)
    yield f'http://127.0.0.1:{port}',login
    server.should_exit=True;thread.join(timeout=10);sock.close()


def command(executable,config,*args):
    return subprocess.run([str(executable),'--config',str(config),*args],capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=20)


def wait_state(executable,config,predicate):
    deadline=time.monotonic()+25
    value=None
    while time.monotonic()<deadline:
        result=command(executable,config,'--status')
        if result.returncode == 0:
            value=json.loads(result.stdout)
            if predicate(value):return value
        time.sleep(.1)
    raise AssertionError(str(value))


def test_test_terminal_switches_all_16_pages_using_account_sessions(test_bundle,test_site,tmp_path):
    executable=test_bundle[0];origin,login=test_site
    config=tmp_path/'test-config.json';config.write_text(json.dumps({'module':'test','serverUrl':origin}),encoding='utf-8')
    process=subprocess.Popen([str(executable),'--config',str(config),'--test-hidden'],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    try:
        first=wait_state(executable,config,lambda state:state.get('documentTitle')=='test-bridge-ready')
        assert first['testClient'] and not first['autoLogin'] and not first['fullScreen']
        assert first['display']['dpiAwareness'] == 'PerMonitorV2'
        assert first['pageZoom'] == 1.0
        assert len(first['navigationLabels']) == 16
        assert first['testNavigationPlacement'] == 'page-top-right'
        assert first['navigationBounds'] == [] and first['headerControlCount'] == 0 and not first['headerVisible']
        assert first['hostPageBounds'] == [0, 0, *first['clientAreaSize']], 'Test-only host controls reduced the normal page viewport'
        assert not any('LIMS' in name or '上位机' in name for name in first['navigationLabels'])
        assert command(executable,config,'--select-tab','visual').returncode == 0
        denied=wait_state(executable,config,lambda state:not state.get('navigationPending') and '登录' in state.get('statusText',''))
        assert denied['activeTab'] == 'central' and denied['currentPath'] == '/login'
        login[0]=True;assert command(executable,config,'--reload').returncode == 0
        wait_state(executable,config,lambda state:state.get('documentTitle')=='test-bridge-ready')
        browser=first['browserPid']
        for page in [dict(module='central',labCode=''),*STATIONS]:
            key=page['labCode'] or page['module']
            assert command(executable,config,'--select-tab',key).returncode == 0
            state=wait_state(executable,config,lambda state:state.get('activeTab')==key and not state.get('navigationPending') and state.get('documentTitle','').startswith('switched:'))
            assert state['browserPid'] == browser
            assert state['pageErrors'] == 0
            assert state['display']['dpiAwareness'] == 'PerMonitorV2' and state['pageZoom'] == 1.0
            assert state['hostPageBounds'] == [0, 0, *state['clientAreaSize']]
            if page['module']=='laboratory':assert page['labCode'] in state['documentTitle']
        for excluded in ['lims','upper-computer']:
            assert command(executable,config,'--select-tab',excluded).returncode != 0
        assert command(executable,config,'--test-hidden').returncode == 0
        assert json.loads(command(executable,config,'--status').stdout)['pid']==process.pid
    finally:
        command(executable,config,'--close');process.wait(timeout=20)


def test_test_client_cannot_be_enabled_by_editing_a_fixed_client_role(test_bundle,tmp_path):
    config=tmp_path/'wrong.json';config.write_text(json.dumps({'module':'laboratory','serverUrl':'http://127.0.0.1:5173'}),encoding='utf-8')
    assert command(test_bundle[0],config,'--validate-config').returncode == 8


def test_renderer_raster_scale_changes_do_not_stretch_page_or_discard_session(test_bundle,test_site,tmp_path):
    config=tmp_path/'display.json';config.write_text(json.dumps({'module':'test','serverUrl':test_site[0]}),encoding='utf-8')
    result=subprocess.run([PS,'-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',str(ROOT/'tests/desktop-client/Test-DisplayScaling.ps1'),
                           '-Executable',str(test_bundle[0]),'-Config',str(config),'-OutputDirectory',str(tmp_path/'captures')],
                          capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=40)
    assert result.returncode==0,result.stdout+result.stderr
    measurements=json.loads((tmp_path/'captures/renderer-scale-results.json').read_text(encoding='utf-8'))
    assert [row['rendererScale'] for row in measurements]==[1,1.25,1.5]
    assert all(row['zoom']==1 for row in measurements)


def test_test_client_page_zoom_input_persistence_navigation_and_dpi(test_bundle,test_site,tmp_path):
    test_site[1][0]=True
    config=tmp_path/'zoom.json';config.write_text(json.dumps({'module':'test','serverUrl':test_site[0]}),encoding='utf-8')
    result=subprocess.run([PS,'-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',str(ROOT/'tests/desktop-client/Test-PageZoom.ps1'),
                           '-Executable',str(test_bundle[0]),'-Config',str(config),'-OutputDirectory',str(tmp_path/'zoom')],
                          capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=90)
    assert result.returncode==0,result.stdout+result.stderr
    measurements=json.loads((tmp_path/'zoom/page-zoom-results.json').read_text(encoding='utf-8'))
    assert measurements['singleWheel']==110 and measurements['restart']==125
    assert measurements['pages']==16 and measurements['dpiScales']==[1,1.25,1.5]
    assert measurements['bounds']==[50,200] and measurements['ordinaryScroll']>0
