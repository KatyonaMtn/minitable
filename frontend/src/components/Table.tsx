import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import axios from 'axios';
import { io } from 'socket.io-client';

// Підключаємося до нашого "проводу" (WebSocket)
const socket = io('http://localhost:3001');

export const Table = () => {
  const [data, setData] = useState<any[]>([]);
  const parentRef = useRef<HTMLDivElement>(null);

  // 1. Завантажуємо дані з бэкенду
  useEffect(() => {
    axios.get('http://localhost:3001/api/rows').then((res) => {
      setData(res.data);
    });

    // Слухаємо оновлення від інших користувачів
    socket.on('cell-updated', (updatedRow) => {
      setData((prev) =>
        prev.map((row) => (row.id === updatedRow.id ? updatedRow : row))
      );
    });

    return () => { socket.off('cell-updated'); };
  }, []);

  // 2. Описуємо колонки (як у твоєму CSV)
  const columns = useMemo<ColumnDef<any>[]>(
    () => [
      { accessorKey: 'id', header: 'ID', size: 50 },
      { accessorKey: 'task_name', header: 'Task Name', size: 250 },
      { accessorKey: 'status', header: 'Status', size: 120 },
      { accessorKey: 'stage', header: 'Stage', size: 120 },
      { accessorKey: 'task_owner', header: 'Owner', size: 150 },
      { accessorKey: 'platform', header: 'Platform', size: 100 },
      { accessorKey: 'product', header: 'Product', size: 100 },
    ],
    []
  );

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  // 3. Магія віртуалізації: рахуємо, що показувати
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 40, // Висота одного рядка в пікселях
    overscan: 10, // Скільки рядків тримати "в запасі" зверху і знизу
  });

  // Функція для редагування (викликається при зміні в ячейці)
  const updateData = async (rowId: number, columnId: string, value: string) => {
    const updatedRow = { ...data.find(r => r.id === rowId), [columnId]: value };
    
    // Оптимістичне оновлення: міняємо у себе відразу, не чекаючи сервера
    setData(prev => prev.map(r => r.id === rowId ? updatedRow : r));
    
    // Відправляємо на сервер
    await axios.patch(`http://localhost:3001/api/rows/${rowId}`, { [columnId]: value });
    // Сповіщаємо інших
    socket.emit('cell-update', updatedRow);
  };

  return (
    <div className="p-4">
      <h1 className="text-xl font-bold mb-4">Airtable Clone ({data.length} rows)</h1>
      
      <div
        ref={parentRef}
        className="border rounded overflow-auto"
        style={{ height: '80vh', width: '100%' }}
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                  display: 'flex',
                  borderBottom: '1px solid #eee',
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    style={{ width: cell.column.getSize(), padding: '8px' }}
                    className="truncate border-r"
                    contentEditable
                    suppressContentEditableWarning
                    onBlur={(e) => 
                      updateData(row.original.id, cell.column.id, e.currentTarget.textContent || '')
                    }
                  >
                    {cell.getContext().renderValue() as string}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};