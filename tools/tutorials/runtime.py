#!/usr/bin/env python3
"""Task-owned loopback services; no inherited provider environment or destructive reset."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
from urllib.parse import quote, urlunsplit

REPO = Path(__file__).resolve().parents[2]
RUNTIME = Path.home() / '.codex/luster-video-runtime/mobile-library-20261015'
PG = Path('/opt/homebrew/opt/postgresql@16/bin')
NODE = Path('/opt/homebrew/bin')
PG_PORT, REDIS_PORT, APP_PORT = 55473, 6399, 3149
APP_ORIGIN = f'http://localhost:{APP_PORT}'
DB_NAME = 'luster_mobile_library'
DB_ROLE = 'luster_library_owner'

def local_service_url(scheme, user, credential, port, database=''):
    authority = f'{quote(user, safe="")}:{quote(credential, safe="")}@127.0.0.1:{port}'
    return urlunsplit((scheme, authority, '/' + database if database else '', '', ''))

def private_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    path.chmod(0o600)

def read_pairs(path):
    pairs = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        pairs[k.strip()] = v.strip().strip('\"\'')
    return pairs

def base_environment():
    return {'HOME': str(Path.home()), 'PATH': f'{NODE}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin',
            'TMPDIR': os.environ.get('TMPDIR', '/tmp'), 'LANG': 'en_US.UTF-8', 'HUSKY': '0'}

def run(args, env=None, quiet=False):
    result = subprocess.run([str(x) for x in args], cwd=REPO, env=env or base_environment(),
                            stdout=subprocess.PIPE if quiet else None,
                            stderr=subprocess.PIPE if quiet else None, text=True)
    if result.returncode:
        raise RuntimeError(f'{Path(str(args[0])).name} failed (exit {result.returncode}); inspect private runtime logs.')
    return result

def environment():
    for name in ('.env', '.env.local', '.env.development', '.env.production', '.env.production.local', '.env.test', '.env.test.local'):
        if (REPO / name).exists():
            raise RuntimeError('Unexpected fallback dotenv file; refused')
    state = json.loads((RUNTIME / 'state.json').read_text())
    if state['repository'] != str(REPO) or state['database'] != DB_NAME or state['role'] != DB_ROLE:
        raise RuntimeError('Runtime identity mismatch')
    values = read_pairs(REPO / '.env.development.local')
    if values.get('DATABASE_URL') != state['database_url'] or values.get('APP_ENV') != 'development':
        raise RuntimeError('Runtime environment mismatch')
    forbidden = ['RESEND_API_KEY','RESEND_FROM_EMAIL','RESEND_REPLY_TO_EMAIL','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN',
                 'TWILIO_VERIFY_SERVICE_SID','TWILIO_PHONE_NUMBER','TWILIO_MESSAGING_SERVICE_SID','LUSTER_SMS_SENDER_IDENTITY',
                 'GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET','GOOGLE_CALENDAR_CLIENT_EMAIL',
                 'GOOGLE_CALENDAR_PRIVATE_KEY','CLOUDINARY_CLOUD_NAME','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET',
                 'OPENAI_API_KEY','OPENAI_API_KEY_OWNER','CRON_SECRET','SENTRY_DSN','SENTRY_AUTH_TOKEN','LOGTAIL_SOURCE_TOKEN']
    if any(values.get(k) for k in forbidden):
        raise RuntimeError('Outbound credential present; refused')
    disabled = ['COMMUNICATIONS_SMS_ENABLED','SMS_PILOT_ENABLED','SMS_BYO_MODE_ENABLED','GOOGLE_CALENDAR_ENABLED',
                'BILLING_SUBSCRIPTIONS_ENABLED','BILLING_TOPUPS_ENABLED','BILLING_TAX_COLLECTION_ENABLED',
                'PUBLIC_PRICING_ENABLED','DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED','OWNER_ASSISTANT_ENABLED',
                'NEXT_PUBLIC_DEV_MODE','LEGACY_OTP_AUTH_ENABLED']
    if any(values.get(k) != 'false' for k in disabled):
        raise RuntimeError('Isolation switch changed; refused')
    placeholders = {'STRIPE_SECRET_KEY':'sk_test_video_disabled','STRIPE_WEBHOOK_SECRET':'whsec_video_disabled',
                    'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY':'pk_test_video_disabled'}
    if any(values.get(k) != v for k, v in placeholders.items()):
        raise RuntimeError('Payment credential mismatch; refused')
    allowed_nonempty = set(disabled) | set(placeholders) | {
        'APP_ENV','BILLING_PLAN_ENV','DATABASE_URL','REDIS_URL','DATABASE_POOL_MAX',
        'CLERK_SECRET_KEY','NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','NEXT_PUBLIC_CLERK_SIGN_IN_URL',
        'NEXT_PUBLIC_CLERK_SIGN_UP_URL','CLERK_AUTHORIZED_PARTIES','NEXT_PUBLIC_APP_URL','PUBLIC_APP_URL',
        'HOST','PORT','NEXT_PUBLIC_SENTRY_DISABLED','NEXT_TELEMETRY_DISABLED',
        'LUSTER_ONBOARDING_MEDIA_DIR','LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED','NETWORK_NO_SHOW_ENABLED','NETWORK_NO_SHOW_HMAC_KEY',
        'BILLING_IDENTITY_HMAC_SECRET','BILLING_IDENTITY_HMAC_VERSION','BILLING_IDENTITY_HMAC_PREVIOUS_KEYS','BILLING_STARTER_IDENTITY_READY'}
    if any(value and key not in allowed_nonempty for key, value in values.items()):
        raise RuntimeError('Unexpected nonempty runtime configuration; refused')
    if not values.get('CLERK_SECRET_KEY','').startswith('sk_test_') or not values.get('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','').startswith('pk_test_'):
        raise RuntimeError('Clerk Development credentials required on every launch')
    redis_credential = None
    for line in (RUNTIME/'redis.conf').read_text().splitlines():
        parts = line.split(' ', 1)
        if len(parts) == 2 and parts[0] == 'requirepass':
            redis_credential = parts[1]
            break
    if not redis_credential or values.get('REDIS_URL') != local_service_url('redis', '', redis_credential, REDIS_PORT):
        raise RuntimeError('Task-local Redis mismatch; refused')
    if any(values.get(key) != APP_ORIGIN for key in ('NEXT_PUBLIC_APP_URL','PUBLIC_APP_URL','CLERK_AUTHORIZED_PARTIES')):
        raise RuntimeError('Recording origin mismatch; refused')
    identity = REPO / 'local/video-runtime/clerk-user.json'
    if identity.exists():
        user_id = json.loads(identity.read_text()).get('userId', '')
        if not user_id.startswith('user_'):
            raise RuntimeError('Invalid synthetic Clerk owner identity')
        values['LUSTER_VIDEO_CLERK_USER_ID'] = user_id
    return {**base_environment(), **values}

def prepare(clerk_env):
    if (RUNTIME / 'state.json').exists():
        environment()
        print('Task runtime already provisioned; no reset performed.')
        return
    if RUNTIME.exists() and any(RUNTIME.iterdir()):
        raise RuntimeError('Unidentified nonempty runtime directory; refused')
    if (REPO / '.env.development.local').exists():
        raise RuntimeError('Existing worktree environment will not be overwritten')
    keys = read_pairs(Path(clerk_env))
    if not keys.get('CLERK_SECRET_KEY','').startswith('sk_test_') or not keys.get('NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY','').startswith('pk_test_'):
        raise RuntimeError('Clerk Development key pair required')
    import socket
    for port in (PG_PORT, REDIS_PORT, APP_PORT):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', port))
    RUNTIME.mkdir(parents=True, mode=0o700)
    RUNTIME.chmod(0o700)
    password = secrets.token_hex(24)
    redis_password = secrets.token_hex(24)
    private_write(RUNTIME / 'postgres-password', password)
    run([PG/'initdb','-D',RUNTIME/'postgres','-U',DB_ROLE,'--pwfile',RUNTIME/'postgres-password',
         '--auth-local=scram-sha-256','--auth-host=scram-sha-256','--encoding=UTF8','--no-locale'],quiet=True)
    (RUNTIME/'socket').mkdir(mode=0o700)
    with (RUNTIME/'postgres/postgresql.conf').open('a') as handle:
        handle.write(f"\nlisten_addresses='127.0.0.1'\nport={PG_PORT}\nunix_socket_directories='{RUNTIME / 'socket'}'\n")
    run([PG/'pg_ctl','-D',RUNTIME/'postgres','-l',RUNTIME/'postgres.log','start'],quiet=True)
    run([PG/'createdb','-h','127.0.0.1','-p',str(PG_PORT),'-U',DB_ROLE,DB_NAME],
        {**base_environment(),'PGPASSWORD':password},quiet=True)
    private_write(RUNTIME/'redis.conf',f'bind 127.0.0.1\nport {REDIS_PORT}\nprotected-mode yes\nrequirepass {redis_password}\ndir {RUNTIME}\ndaemonize yes\npidfile {RUNTIME}/redis.pid\nlogfile {RUNTIME}/redis.log\nsave ""\nappendonly no\n')
    run(['/opt/homebrew/bin/redis-server',RUNTIME/'redis.conf'],quiet=True)
    db_url = local_service_url('postgresql', DB_ROLE, password, PG_PORT, DB_NAME)
    values = {'APP_ENV':'development','BILLING_PLAN_ENV':'dev','DATABASE_URL':db_url,
        'REDIS_URL':local_service_url('redis', '', redis_password, REDIS_PORT),'DATABASE_POOL_MAX':'2',
        'CLERK_SECRET_KEY':keys['CLERK_SECRET_KEY'],'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY':keys['NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY'],
        'NEXT_PUBLIC_CLERK_SIGN_IN_URL':'/owner-sign-in','NEXT_PUBLIC_CLERK_SIGN_UP_URL':'/owner-sign-up',
        'CLERK_AUTHORIZED_PARTIES':APP_ORIGIN,'NEXT_PUBLIC_APP_URL':APP_ORIGIN,'PUBLIC_APP_URL':APP_ORIGIN,
        'HOST':'localhost','PORT':str(APP_PORT),'NEXT_PUBLIC_DEV_MODE':'false','LEGACY_OTP_AUTH_ENABLED':'false',
        'STRIPE_SECRET_KEY':'sk_test_video_disabled','STRIPE_WEBHOOK_SECRET':'whsec_video_disabled',
        'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY':'pk_test_video_disabled','NEXT_PUBLIC_SENTRY_DISABLED':'true',
        'NEXT_TELEMETRY_DISABLED':'1','LUSTER_NONPROD_DB_HOSTS':'',
        'LUSTER_ONBOARDING_MEDIA_DIR':str(RUNTIME/'media'),
        'LUSTER_ONBOARDING_V1_INTEGRATION_ENABLED':'true'}
    for key in ['COMMUNICATIONS_SMS_ENABLED','SMS_PILOT_ENABLED','SMS_BYO_MODE_ENABLED','GOOGLE_CALENDAR_ENABLED',
                'BILLING_SUBSCRIPTIONS_ENABLED','BILLING_TOPUPS_ENABLED','BILLING_TAX_COLLECTION_ENABLED',
                'PUBLIC_PRICING_ENABLED','DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED','OWNER_ASSISTANT_ENABLED']:
        values[key]='false'
    for key in ['RESEND_API_KEY','RESEND_FROM_EMAIL','RESEND_REPLY_TO_EMAIL','TWILIO_ACCOUNT_SID','TWILIO_AUTH_TOKEN',
                'TWILIO_VERIFY_SERVICE_SID','TWILIO_PHONE_NUMBER','TWILIO_MESSAGING_SERVICE_SID',
                'LUSTER_SMS_SENDER_IDENTITY','GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET',
                'GOOGLE_CALENDAR_CLIENT_EMAIL','GOOGLE_CALENDAR_PRIVATE_KEY','CLOUDINARY_CLOUD_NAME',
                'CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET','LOGTAIL_SOURCE_TOKEN','SENTRY_DSN','SENTRY_AUTH_TOKEN']:
        values[key]=''
    if APP_PORT in (3148, 3149):
        values['NETWORK_NO_SHOW_ENABLED']='true'
        values['NETWORK_NO_SHOW_HMAC_KEY']='isolated-mobile-pilot-network-key-never-production-20261014'
    private_write(REPO/'.env.development.local','\n'.join(f'{k}={v}' for k,v in values.items())+'\n')
    private_write(RUNTIME/'state.json',json.dumps({'repository':str(REPO),'database':DB_NAME,'role':DB_ROLE,'database_url':db_url}))
    print('Created task-owned loopback PostgreSQL/Redis. Credentials saved privately; no providers configured.')

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('action',choices=['prepare','initialize','migrate','verify','seed-plan','seed-apply','seed-no-show','dev','build','start','status'])
    parser.add_argument('--clerk-env')
    parser.add_argument('--variant',choices=['main','noshow'],default='main')
    args=parser.parse_args()
    global RUNTIME, DB_NAME, DB_ROLE, PG_PORT, REDIS_PORT, APP_PORT, APP_ORIGIN
    if args.variant=='noshow':
        if not (REPO/'src/libs/noShowReporting.ts').exists(): raise RuntimeError('PR #449 candidate source required for no-show capture')
        RUNTIME=Path.home()/'.codex/luster-video-runtime/mobile-noshow-20261014'
        DB_NAME,DB_ROLE='luster_mobile_noshow','luster_noshow_owner'
        PG_PORT,REDIS_PORT,APP_PORT=55472,6398,3148
        APP_ORIGIN=f'http://localhost:{APP_PORT}'
    if args.action=='prepare':
        if not args.clerk_env: raise RuntimeError('--clerk-env required; values never printed')
        prepare(args.clerk_env); return
    env=environment()
    if args.action=='seed-no-show':
        if args.variant!='noshow': raise RuntimeError('No-show fixture requires the isolated no-show runtime')
        env['NODE_OPTIONS']='--conditions=react-server'
    commands={'seed-no-show':['node_modules/.bin/tsx','tools/tutorials/seed-no-show.ts'],'initialize':['npm','run','db:initialize:development'],
        'migrate':['npm','run','db:migrate:development'],'verify':['npm','run','db:verify:development'],
        'seed-plan':['node_modules/.bin/tsx','tools/tutorials/seed.ts'],
        'seed-apply':['node_modules/.bin/tsx','tools/tutorials/seed.ts','--apply'],
        'dev':['node_modules/.bin/next','dev','--hostname','localhost','--port',str(APP_PORT)],
        'build':['npm','run','build'],'start':['node_modules/.bin/next','start','--hostname','localhost','--port',str(APP_PORT)]}
    if args.action=='status':
        print(json.dumps({'runtime':str(RUNTIME),'database':'task-owned loopback','origin':APP_ORIGIN,'environment':'development',
            'outbound_credentials':'absent','clerk':'test','narration_key_in_app':False},indent=2)); return
    run(commands[args.action],env)
    if args.action == 'build':
        import hashlib
        patch = subprocess.check_output(['git', 'diff', '--', 'src'], cwd=REPO)
        identity = {
            'baselineMain': 'ad28e325b646b19dea481aec83d3d6d5ff5dbac5',
            'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=REPO, text=True).strip(),
            'sourcePatchSha256': hashlib.sha256(patch).hexdigest(),
            'compiledBuildId': (REPO / '.next/BUILD_ID').read_text().strip(),
        }
        private_write(REPO / 'local/video-runtime/compiled-source.json', json.dumps(identity, indent=2))

if __name__=='__main__':
    try: main()
    except Exception as error:
        print(f'Video runtime stopped safely: {error}',file=sys.stderr);sys.exit(1)
