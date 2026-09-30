# ============================================================
# Multi-stage: stage 1 build frontend (Node, khong ton tai trong image
# cuoi), stage 2 base HA + Python phuc vu API va static file da build.
# Ly do khac Dockerfile cua PZEM (khong co stage Node): addon do la 1 file
# .py thuan, addon nay co 1 project React/TS/Vite that su can buoc build.
# Xem SPEC.md muc "Quyet dinh lech spec" #2.
# ============================================================
# ARG dung cho FROM phai khai bao TRUOC FROM DAU TIEN trong ca file de co
# hieu luc "global" xuyen qua nhieu stage - khai o giua 2 stage (nhu ban
# dau) khien BuildKit coi BUILD_FROM la rong, loi "base name should not be
# blank" (da gap thuc te 2026-09-22, xem DEVELOPMENT.md).
#
# Use the unified Home Assistant base image. Normalize Windows line endings
# before running the entrypoint through with-contenv.
ARG BUILD_FROM=ghcr.io/home-assistant/base:latest
ARG BUILD_VERSION

FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build
ARG BUILD_VERSION
WORKDIR /frontend
COPY ./frontend/package.json ./frontend/package-lock.json* ./
RUN npm ci
COPY ./frontend/ ./
RUN npm run build && printf '%s\n' "$BUILD_VERSION" > dist/build-version.txt

FROM $BUILD_FROM

ARG BUILD_VERSION
ARG BUILD_ARCH
LABEL \
    io.hass.version="$BUILD_VERSION" \
    io.hass.type="app" \
    io.hass.arch="$BUILD_ARCH"

RUN \
    apk add --no-cache \
    python3 \
    py3-pip \
    tzdata

EXPOSE 8123

COPY ./backend/requirements.txt /app/requirements.txt
WORKDIR /app
RUN pip install --break-system-packages -r requirements.txt

COPY ./backend/app /app/app
COPY --from=frontend-build /frontend/dist /app/static
COPY ./run.sh /app/run.sh
RUN sed -i 's/\r$//' /app/run.sh && chmod +x /app/run.sh

CMD [ "/app/run.sh" ]
