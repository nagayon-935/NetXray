#!/bin/bash

# --- Configuration ---
IMAGE_NAME="netxray:latest"
CONTAINER_NAME="netxray-server"
HOST_LABS_DIR="/home/nagayoshi/frr" 
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
    # 重要なフラグ:
    # --network host: ホストのブリッジインターフェースを参照可能にする
    # --privileged: ネットワーク操作権限を付与
    # --pid host: 他のコンテナのネットワーク名前空間にアクセスしてリンクを作成するために必要
    # -v ...: ホストと全く同じパスでマウントし、containerlabのパス不一致を防ぐ
    docker run -d \
        --name $CONTAINER_NAME \
        --network host \
        --privileged \
        --pid host \
        -e PYTHONUNBUFFERED=1 \
        -v /var/run/docker.sock:/var/run/docker.sock \
        -v $HOST_LABS_DIR:$HOST_LABS_DIR \
        -e NETXRAY_CLAB_LABS_DIR=$HOST_LABS_DIR \
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
