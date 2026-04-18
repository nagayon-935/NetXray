import { Position, type InternalNode } from "@xyflow/react";

function getNodeCenter(node: InternalNode) {
  return {
    x: node.internals.positionAbsolute.x + (node.measured?.width || 180) / 2,
    y: node.internals.positionAbsolute.y + (node.measured?.height || 60) / 2,
  };
}

function getHandleCoordsByPosition(node: InternalNode, handlePosition: Position) {
  const nodeW = node.measured?.width || 180;
  const nodeH = node.measured?.height || 60;

  let handleX = node.internals.positionAbsolute.x + nodeW / 2;
  let handleY = node.internals.positionAbsolute.y + nodeH / 2;

  switch (handlePosition) {
    case Position.Left:
      handleX = node.internals.positionAbsolute.x;
      break;
    case Position.Right:
      handleX = node.internals.positionAbsolute.x + nodeW;
      break;
    case Position.Top:
      handleY = node.internals.positionAbsolute.y;
      break;
    case Position.Bottom:
      handleY = node.internals.positionAbsolute.y + nodeH;
      break;
  }

  return [handleX, handleY];
}

function getParams(nodeA: InternalNode, nodeB: InternalNode): [number, number, Position] {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const horizontalDiff = Math.abs(centerA.x - centerB.x);
  const verticalDiff = Math.abs(centerA.y - centerB.y);

  let position;
  if (horizontalDiff > verticalDiff) {
    position = centerA.x > centerB.x ? Position.Left : Position.Right;
  } else {
    position = centerA.y > centerB.y ? Position.Top : Position.Bottom;
  }

  const [x, y] = getHandleCoordsByPosition(nodeA, position);
  return [x, y, position];
}

export function getEdgeParams(source: InternalNode | undefined, target: InternalNode | undefined) {
  if (!source || !target) return null;
  const [sx, sy, sourcePos] = getParams(source, target);
  const [tx, ty, targetPos] = getParams(target, source);

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos: sourcePos as Position,
    targetPos: targetPos as Position,
  };
}