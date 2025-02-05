import cx from 'classnames'
import React, { CSSProperties } from 'react'
import { AbstractTreeNode, ArtColumn } from '../interfaces'
import { getTreeDepth, isLeafNode } from '../utils'
import { HorizontalRenderRange, RenderInfo } from './interfaces'
import { Classes } from './styles'

function range(n: number) {
  const array: number[] = []
  for (let i = 0; i < n; i++) {
    array.push(i)
  }
  return array
}

type ColWithRenderInfo =
  {
    type: 'normal'
    colIndex: number
    col: ArtColumn
    colSpan: number
    isLeaf: boolean
    width: number
    leftTopCellId?: string
    isLeafParent?: boolean
  }
  | { type: 'blank'; blankSide: 'left' | 'right'; width: number, colSpan?: number, leftTopCellId?: string }

type IndexedCol = {
  colIndex: number
  col: ArtColumn
  children?: IndexedCol[]
}

/** 根据当前横向虚拟滚动 对 nested.center 进行过滤，结果只保留当前视野内可见的那些列配置 */
function filterNestedCenter(centerNested: ArtColumn[], hoz: HorizontalRenderRange, leftFlatCount: number) {
  return dfs(centerNested, leftFlatCount).filtered

  function dfs(cols: ArtColumn[], startColIndex: number) {
    let leafCount = 0

    const filtered: IndexedCol[] = []

    for (const col of cols) {
      const colIndex = startColIndex + leafCount
      if (isLeafNode(col)) {
        leafCount += 1
        if (leftFlatCount + hoz.leftIndex <= colIndex && colIndex < leftFlatCount + hoz.rightIndex) {
          filtered.push({ colIndex, col })
        }
      } else {
        const dfsRes = dfs(col.children, colIndex)
        leafCount += dfsRes.leafCount
        if (dfsRes.filtered.length > 0) {
          filtered.push({ colIndex, col, children: dfsRes.filtered })
        }
      }
    }

    return { filtered, leafCount }
  }
}

/** 根据输入的 nested 列配置，算出相应的 leveled & flat 配置方便渲染 */
function calculateLeveledAndFlat(inputNested: IndexedCol[], rowCount: number, isMergeLeafNodes = true) {
  const leveled: ColWithRenderInfo[][] = []
  for (let depth = 0; depth < rowCount; depth++) {
    leveled.push([])
  }
  const flat: ColWithRenderInfo[] = []

  dfs(inputNested, 0)

  return { flat, leveled }

  /** 判断是否是叶子结点的父节点 */
  function isLeafParentNode(node: AbstractTreeNode) {
    return node.children && node.children.length > 0 && (!node.children[0].children || node.children[0].children.length === 0)
  }

  function dfs(input: IndexedCol[], depth: number) {
    let leafCount = 0
    for (let i = 0; i < input.length; i++) {
      const indexedCol = input[i]

      if (isLeafNode(indexedCol)) {
        leafCount += 1
        const wrapped = {
          type: 'normal' as const,
          width: indexedCol.col.width,
          col: indexedCol.col,
          colIndex: indexedCol.colIndex,
          colSpan: 1,
          isLeaf: true,
        }
        // 叶子节点放到列表头的最后一行
        if (isMergeLeafNodes === false && indexedCol.col.columnType !== 'left')
          leveled[leveled.length - 1].push(wrapped)
        else
          leveled[depth].push(wrapped)
        flat.push(wrapped)
      } else {
        const dfsRes = dfs(indexedCol.children, depth + 1)
        leafCount += dfsRes.leafCount
        if (dfsRes.leafCount > 0) {
          leveled[depth].push({
            type: 'normal',
            width: indexedCol.col.width,
            col: indexedCol.col,
            colIndex: indexedCol.colIndex,
            colSpan: dfsRes.leafCount,
            isLeaf: false,
            isLeafParent: isLeafParentNode(indexedCol)
          })
        }
      }
    }

    return { leafCount }
  }
}

/** 包装列配置，附加上 colIndex 属性 */
function attachColIndex(inputNested: ArtColumn[], colIndexOffset: number) {
  return dfs(inputNested, colIndexOffset).result

  function dfs(input: ArtColumn[], startColIndex: number) {
    const result: IndexedCol[] = []

    let leafCount = 0
    for (let i = 0; i < input.length; i++) {
      const col = input[i]
      const colIndex = startColIndex + leafCount

      if (isLeafNode(col)) {
        leafCount += 1
        result.push({ colIndex, col })
      } else {
        const sub = dfs(col.children, colIndex)
        leafCount += sub.leafCount
        if (sub.leafCount > 0) {
          result.push({ col, colIndex, children: sub.result })
        }
      }
    }
    return { result, leafCount }
  }
}

/** 计算用于渲染表头的数据结构 */
function calculateHeaderRenderInfo(
  { flat, nested, horizontalRenderRange: hoz, useVirtual, isMergeLeafNodes = true }: RenderInfo,
  rowCount: number,
): { flat: ColWithRenderInfo[]; leveled: ColWithRenderInfo[][] } {
  if (useVirtual.header) {
    const leftPart = calculateLeveledAndFlat(attachColIndex(nested.left, 0), rowCount)
    const filtered = filterNestedCenter(nested.center, hoz, flat.left.length)
    // 开启虚拟化
    const centerPart = calculateLeveledAndFlat(filtered, rowCount, isMergeLeafNodes)
    const rightPart = calculateLeveledAndFlat(
      attachColIndex(nested.right, flat.left.length + flat.center.length),
      rowCount,
    )

    return {
      flat: [
        ...leftPart.flat,
        { type: 'blank', width: hoz.leftBlank, blankSide: 'left' },
        ...centerPart.flat,
        { type: 'blank', width: hoz.rightBlank, blankSide: 'right' },
        ...rightPart.flat,
      ],
      leveled: range(rowCount).map((depth) => [
        ...leftPart.leveled[depth],
        { type: 'blank', width: hoz.leftBlank, blankSide: 'left' },
        ...centerPart.leveled[depth],
        { type: 'blank', width: hoz.rightBlank, blankSide: 'right' },
        ...rightPart.leveled[depth],
      ]),
    }
  }

  return calculateLeveledAndFlat(attachColIndex(nested.full, 0), rowCount, isMergeLeafNodes)
}

export default function TableHeader({ info }: { info: RenderInfo }) {
  const { nested, flat, stickyLeftMap, stickyRightMap, leftTopCellId, isMergeLeafNodes } = info
  const rowCount = getTreeDepth(nested.full) + 1
  const headerRenderInfo = calculateHeaderRenderInfo(info, rowCount)
  /** 合并左上方空白单元格
   *  start
   */
  if (leftTopCellId && headerRenderInfo.leveled && headerRenderInfo.leveled[0]) {
    const leftTopEmptyCellNumber = nested.left.length
    headerRenderInfo.leveled[0][0].colSpan = leftTopEmptyCellNumber
    headerRenderInfo.leveled[0][0].leftTopCellId = leftTopCellId
    headerRenderInfo.leveled[0].splice(1, leftTopEmptyCellNumber - 1)
  }
  /** end */
  const fullFlatCount = flat.full.length
  const leftFlatCount = flat.left.length
  const rightFlatCount = flat.right.length

  const thead = headerRenderInfo.leveled.map((wrappedCols, level) => {
    const headerCells = wrappedCols.map((wrapped) => {
      if (wrapped.type === 'normal') {
        const { colIndex, colSpan, isLeaf, col, isLeafParent } = wrapped

        const headerCellProps = col.headerCellProps ?? {}

        const positionStyle: CSSProperties = {}
        if (colIndex < leftFlatCount) {
          positionStyle.position = 'sticky'
          positionStyle.left = stickyLeftMap.get(colIndex)
        } else if (colIndex >= fullFlatCount - rightFlatCount) {
          positionStyle.position = 'sticky'
          positionStyle.right = stickyRightMap.get(colIndex + colSpan - 1)
        }

        let rowSpan: number
        if (isLeaf) {
          if (isMergeLeafNodes === false && wrapped.col.columnType !== 'left')
            rowSpan = 1
          else
            rowSpan = rowCount - level
        } else if (isLeafParent && isMergeLeafNodes === false)
          rowSpan = rowCount - level - 1

        return (
          <th
            id={leftTopCellId && leftTopCellId}
            key={colIndex}
            {...headerCellProps}
            className={cx(Classes.tableHeaderCell, headerCellProps.className, {
              first: colIndex === 0,
              last: colIndex + colSpan === fullFlatCount,
              'lock-left': colIndex < leftFlatCount,
              'lock-right': colIndex >= fullFlatCount - rightFlatCount,
            })}
            colSpan={colSpan}
            rowSpan={rowSpan}
            // rowSpan={isLeaf ? rowCount - level : undefined}
            style={{
              textAlign: col.align,
              ...headerCellProps.style,
              ...positionStyle,
            }}
          >
            {col.title ?? col.name}
          </th>
        )
      } else {
        if (wrapped.width > 0) {
          return <th key={wrapped.blankSide} />
        } else {
          return null
        }
      }
    })

    return (
      <tr
        key={level}
        className={cx(Classes.tableHeaderRow, {
          first: level === 0,
          last: level === rowCount - 1,
        })}
      >
        {headerCells}
      </tr>
    )
  })

  return (
    <table>
      <colgroup>
        {headerRenderInfo.flat.map((wrapped) => {
          if (wrapped.type === 'blank') {
            if (wrapped.width > 0) {
              return <col key={wrapped.blankSide} style={{ width: wrapped.width }} />
            } else {
              return null
            }
          } else {
            return <col key={wrapped.colIndex} style={{ width: wrapped.width }} />
          }
        })}
      </colgroup>
      <thead>{thead}</thead>
    </table>
  )
}
