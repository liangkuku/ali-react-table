import { collectNodes, isLeafNode } from '../utils'
import { ArtColumn } from '../interfaces'
import { VirtualEnum } from './interfaces'
import { BaseTableProps, BaseTableState } from './table'
import { AUTO_VIRTUAL_THRESHOLD } from './utils'

function resolveVirtualEnabled(virtualEnum: VirtualEnum, defaultValue: boolean) {
  if (virtualEnum == null || virtualEnum === 'auto') {
    return defaultValue
  }
  return virtualEnum
}

/** 检查列配置 & 设置默认宽度 & 剔除隐藏的列 */
function processColumns(columns: ArtColumn[], defaultColumnWidth: number) {
  function dfs(columns: ArtColumn[]): ArtColumn[] {
    const result: ArtColumn[] = []

    for (let column of columns) {
      if (column.width == null) {
        if (defaultColumnWidth != null) {
          column = { ...column, width: defaultColumnWidth }
        } else if (process.env.NODE_ENV !== 'production' && isLeafNode(column) && column.lock) {
          console.warn('[ali-react-table] 锁列需要指定列宽度', column)
        }
      }

      if (isLeafNode(column)) {
        // 被隐藏的列 会在这里被剔除
        if (!column.hidden) {
          result.push(column)
        }
      } else {
        const nextChildren = dfs(column.children)
        // 如果 nextChildren 为空，说明所有的子节点均被隐藏了，在这里隐藏父节点
        if (nextChildren.length > 0) {
          result.push({ ...column, children: nextChildren })
        }
      }
    }
    return result
  }

  return dfs(columns)
}

function getLeftNestedLockCount(columns: ArtColumn[]) {
  let nestedCount = 0

  for (const col of columns) {
    if (isLock(col)) {
      nestedCount += 1
    } else {
      break
    }
  }
  return nestedCount

  function isLock(col: ArtColumn): boolean {
    if (isLeafNode(col)) {
      return col.lock
    } else {
      return col.lock || col.children.some(isLock)
    }
  }
}

export default function getDerivedStateFromProps(
  props: Readonly<BaseTableProps>,
  state: BaseTableState,
): Pick<BaseTableState, 'flat' | 'nested' | 'useVirtual' | 'stickyLeftMap' | 'stickyRightMap'> {
  const { useVirtual: useVirtualProp, columns: columnsProp, dataSource: dataSourceProp, defaultColumnWidth } = props

  const columns = processColumns(columnsProp, defaultColumnWidth)

  const leftNestedLockCount = getLeftNestedLockCount(columns)

  const fullFlat = collectNodes(columns, 'leaf-only')

  if (leftNestedLockCount === columns.length) {
    // 处理所有的列均为 lock
    return {
      flat: { left: [], right: [], full: fullFlat, center: fullFlat },
      nested: { left: [], right: [], full: columns, center: columns },
      useVirtual: { horizontal: false, vertical: false, header: false },
      stickyLeftMap: new Map(),
      stickyRightMap: new Map(),
    }
  }

  const leftNested = columns.slice(0, leftNestedLockCount)
  const rightNestedLockCount = getLeftNestedLockCount(columns.slice().reverse())
  const centerNested = columns.slice(leftNestedLockCount, columns.length - rightNestedLockCount)
  const rightNested = columns.slice(columns.length - rightNestedLockCount)

  const shouldEnableHozVirtual = fullFlat.length >= AUTO_VIRTUAL_THRESHOLD && fullFlat.every((col) => col.width != null)
  const shouldEnableVerVirtual = dataSourceProp.length >= AUTO_VIRTUAL_THRESHOLD

  const useVirtual =
    typeof useVirtualProp !== 'object'
      ? {
          horizontal: resolveVirtualEnabled(useVirtualProp, shouldEnableHozVirtual),
          vertical: resolveVirtualEnabled(useVirtualProp, shouldEnableVerVirtual),
          header: resolveVirtualEnabled(useVirtualProp, false),
        }
      : {
          horizontal: resolveVirtualEnabled(useVirtualProp.horizontal, shouldEnableHozVirtual),
          vertical: resolveVirtualEnabled(useVirtualProp.vertical, shouldEnableVerVirtual),
          header: resolveVirtualEnabled(useVirtualProp.header, shouldEnableVerVirtual),
        }

  const flat = {
    left: collectNodes(leftNested, 'leaf-only'),
    full: fullFlat,
    right: collectNodes(rightNested, 'leaf-only'),
    center: collectNodes(centerNested, 'leaf-only'),
  }

  const fullFlatCount = flat.full.length
  const leftFlatCount = flat.left.length
  const rightFlatCount = flat.right.length

  const stickyLeftMap = new Map<number, number>()
  let stickyLeft = 0
  for (let i = 0; i < leftFlatCount; i++) {
    stickyLeftMap.set(i, stickyLeft)
    stickyLeft += flat.full[i].width
  }

  const stickyRightMap = new Map<number, number>()
  let stickyRight = 0
  for (let i = 0; i < rightFlatCount; i++) {
    stickyRightMap.set(fullFlatCount - 1 - i, stickyRight)
    stickyRight += flat.full[fullFlatCount - 1 - i].width
  }

  return {
    flat,
    nested: {
      left: leftNested,
      full: columns,
      right: rightNested,
      center: centerNested,
    },
    useVirtual,
    stickyLeftMap,
    stickyRightMap,
  }
}
