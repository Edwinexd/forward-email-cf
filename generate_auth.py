import secrets
import hashlib

salt = secrets.token_urlsafe(128)

secret = secrets.token_urlsafe(256)

hash_ = hashlib.sha256()
hash_.update(secret.encode('utf-8'))
hash_.update(salt.encode('utf-8'))

print(f"Hash: {hash_.hexdigest()}")
print(f"Salt: {salt}")
print(f"Secret: {secret}")
