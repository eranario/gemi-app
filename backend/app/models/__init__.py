# Re-export all models for easy importing
# Usage: from app.models import User, Item, FileUpload

from sqlmodel import SQLModel

from app.models.user import (
    User,
    UserBase,
    UserCreate,
    UserPublic,
    UserRegister,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
    UpdatePassword,
)

from app.models.item import (
    Item,
    ItemBase,
    ItemCreate,
    ItemPublic,
    ItemsPublic,
    ItemUpdate,
)

from app.models.file_upload import (
    FileUpload,
    FileUploadBase,
    FileUploadCreate,
    FileUploadPublic,
    FileUploadsPublic,
    FileUploadUpdate,
)

from app.models.common import (
    Message,
    NewPassword,
    Token,
    TokenPayload,
)
