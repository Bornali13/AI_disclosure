from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

pw = "!0no@ghost"
print("Password length:", len(pw))
print(pwd_context.hash(pw))