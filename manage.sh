#!/bin/bash

# --- Configuration ---
IMAGE_NAME="netxray:latest"
CONTAINER_NAME="netxray-server"
# ユーザーのホームディレクトリをベースにする
BASE_DIR="/home/nagayoshi"
PORT=8000

# --- Functions ---
build() {
    echo "Building image $IMAGE_NAME..."
    docker build -t $IMAGE_NAME .
}

up() {
    if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
        docker rm -f $CONTAINER_NAME
    fi

    echo "Starting NetXray on http://localhost:$PORT ..."
    # frr と c9lab の両方を含めるため、共通の親ディレクトリをマウント
    # 互換性のために環境変数も設定
    docker run -d \
        --name $CONTAINER_NAME \
        --network host \
        --privileged \
        --pid host \
        -e PYTHONUNBUFFERED=1 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v $BASE_DIR/frr:$BASE_DIR/frr \
        -v $BASE_DIR/c9lab:$BASE_DIR/c9lab \
        -e NETXRAY_CLAB_LABS_DIR=$BASE_DIR \
        $IMAGE_NAME

    echo "Done."
}

down() {
    docker rm -f $CONTAINER_NAME
}

case "$1" in
    build) build ;;
    up)    up ;;
    down)  down ;;
    restart) down && up ;;
    logs)  docker logs -f $CONTAINER_NAME ;;
    *)     echo "Usage: ./manage.sh {build|up|down|restart|logs}" ;;
esac
