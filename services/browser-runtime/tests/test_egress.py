import unittest

from app.egress import destination_allowed


class EgressPolicyTest(unittest.TestCase):
    def test_default_https_uses_the_explicit_host(self):
        self.assertTrue(destination_allowed({"app.example.com"}, "app.example.com", 443))
        self.assertFalse(destination_allowed({"app.example.com"}, "api.example.com", 443))

    def test_alternative_port_must_be_explicit_for_the_same_host(self):
        policy = {"app.example.com", "api.example.com:8443"}
        self.assertTrue(destination_allowed(policy, "api.example.com", 8443))
        self.assertFalse(destination_allowed({"api.example.com"}, "api.example.com", 8443))
        self.assertFalse(destination_allowed(policy, "api.example.com", 22))


if __name__ == "__main__":
    unittest.main()
