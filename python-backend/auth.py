import os
from fastapi import Depends, HTTPException, status, Request
import jwt
from jwt import PyJWKClient
from dotenv import load_dotenv

load_dotenv()

CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY")
CLERK_FRONTEND_API = os.getenv("CLERK_FRONTEND_API", "https://clerk.querysage.com")  # Replace with actual

jwks_client = PyJWKClient(f"{CLERK_FRONTEND_API}/.well-known/jwks.json")

def get_current_user(request: Request):
    """
    Dependency to verify Clerk JWT token from the Authorization header.
    Returns the user_id (sub).
    """
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
        )
    
    token = auth_header.split(" ")[1]
    
    try:
        # Decode without verification to get the issuer
        unverified_data = jwt.decode(token, options={"verify_signature": False})
        issuer = unverified_data.get("iss")
        
        if not issuer:
            raise HTTPException(status_code=401, detail="Token missing issuer")
            
        jwks_url = f"{issuer}/.well-known/jwks.json"
        jwks_client = PyJWKClient(jwks_url)
        
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        data = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_aud": False} # Adjust based on Clerk settings
        )
        user_id = data.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
        return user_id
    except jwt.exceptions.PyJWKClientError as e:
        raise HTTPException(status_code=401, detail=f"JWKS Error: {str(e)}")
    except jwt.exceptions.DecodeError:
        raise HTTPException(status_code=401, detail="Invalid token")
    except jwt.exceptions.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception as e:
        # Fallback for dev environment if testing without Clerk
        if os.getenv("ENVIRONMENT") == "development" and token == "test-token":
            return "user_test_123"
        raise HTTPException(status_code=401, detail=f"Authentication error: {str(e)}")
