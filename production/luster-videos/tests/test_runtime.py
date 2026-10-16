import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('video_runtime', Path(__file__).resolve().parents[1] / 'demo/runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeIsolationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name) / 'repo'
        self.state = Path(self.temp.name) / 'runtime'
        self.repo.mkdir()
        self.state.mkdir()
        self.values = {
            'APP_ENV': 'development', 'DATABASE_URL': 'task-owned-test-connection',
            'REDIS_URL': runtime.local_service_url('redis', '', 'fixture', 6391),
            'CLERK_SECRET_KEY': 'sk_test_fixture', 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': 'pk_test_fixture',
            'STRIPE_SECRET_KEY': 'sk_test_video_disabled', 'STRIPE_WEBHOOK_SECRET': 'whsec_video_disabled',
            'NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY': 'pk_test_video_disabled',
        }
        for key in ('COMMUNICATIONS_SMS_ENABLED', 'SMS_PILOT_ENABLED', 'SMS_BYO_MODE_ENABLED', 'GOOGLE_CALENDAR_ENABLED',
                    'BILLING_SUBSCRIPTIONS_ENABLED', 'BILLING_TOPUPS_ENABLED', 'BILLING_TAX_COLLECTION_ENABLED',
                    'PUBLIC_PRICING_ENABLED', 'DEPOSITS_CONNECT_WEBHOOK_PROCESSING_ENABLED', 'OWNER_ASSISTANT_ENABLED',
                    'NEXT_PUBLIC_DEV_MODE', 'LEGACY_OTP_AUTH_ENABLED'):
            self.values[key] = 'false'
        for key in ('NEXT_PUBLIC_APP_URL', 'PUBLIC_APP_URL', 'CLERK_AUTHORIZED_PARTIES'):
            self.values[key] = runtime.APP_ORIGIN
        (self.state / 'redis.conf').write_text('requirepass fixture\n')
        (self.state / 'state.json').write_text(json.dumps({'repository': str(self.repo), 'database': runtime.DB_NAME,
                                                        'role': runtime.DB_ROLE, 'database_url': self.values['DATABASE_URL']}))
        self.patches = [patch.object(runtime, 'REPO', self.repo), patch.object(runtime, 'RUNTIME', self.state)]
        for item in self.patches:
            item.start()

    def tearDown(self):
        for item in self.patches:
            item.stop()
        self.temp.cleanup()

    def check(self):
        (self.repo / '.env.development.local').write_text('\n'.join(f'{k}={v}' for k, v in self.values.items()))
        return runtime.environment()

    def test_task_local_configuration_is_allowed(self):
        self.assertEqual(self.check()['APP_ENV'], 'development')

    def test_live_auth_credentials_are_rejected(self):
        self.values['CLERK_SECRET_KEY'] = 'sk_live_fixture'
        with self.assertRaises(RuntimeError):
            self.check()

    def test_remote_redis_is_rejected(self):
        self.values['REDIS_URL'] = 'redis://remote.example.invalid:6379'
        with self.assertRaises(RuntimeError):
            self.check()

    def test_unrecognized_provider_configuration_is_rejected(self):
        for key in ('NEXT_PUBLIC_SENTRY_DSN', 'OPENAI_API_KEY_VOICE', 'CHECKLY_HEARTBEAT_URL'):
            with self.subTest(key=key):
                self.values[key] = 'fixture-not-a-real-credential'
                with self.assertRaises(RuntimeError):
                    self.check()
                del self.values[key]

    def test_nonlocal_origin_is_rejected(self):
        self.values['PUBLIC_APP_URL'] = 'https://example.invalid'
        with self.assertRaises(RuntimeError):
            self.check()

    def test_fallback_environment_file_is_rejected(self):
        (self.repo / '.env.production').write_text('# unexpected')
        with self.assertRaises(RuntimeError):
            self.check()

    def test_enabled_delivery_switch_is_rejected(self):
        self.values['COMMUNICATIONS_SMS_ENABLED'] = 'true'
        with self.assertRaises(RuntimeError):
            self.check()


if __name__ == '__main__':
    unittest.main()
