import { useState, useRef, useCallback, useEffect } from 'react';

interface ImageFile {
  id: string;
  name: string;
  url: string;
  thumbnail: string;
  fileHandle?: FileSystemFileHandle;
  file?: File;
}

// 目录句柄存储
let directoryHandle: FileSystemDirectoryHandle | null = null;

// 创建缩略图 - 压缩图片以提高性能
const createThumbnail = (file: File, maxSize: number = 250): Promise<string> => {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width);
            width = maxSize;
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height);
            height = maxSize;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const thumbnail = canvas.toDataURL('image/jpeg', 0.5);
          URL.revokeObjectURL(url);
          resolve(thumbnail);
        } else {
          resolve(url);
        }
      } catch (err) {
        resolve(url);
      }
    };
    
    img.onerror = () => {
      resolve(url);
    };
    
    img.src = url;
  });
};

// 检查是否支持 File System Access API
const supportsFileSystemAccess = () => {
  return 'showDirectoryPicker' in window;
};

export function App() {
  const [images, setImages] = useState<ImageFile[]>([]);
  const [selectedImage, setSelectedImage] = useState<ImageFile | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState({ current: 0, total: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const [useFileSystemAPI, setUseFileSystemAPI] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  const generateId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  };

  // 计算容器尺寸
  useEffect(() => {
    const updateSize = () => {
      if (containerRef.current) {
        setContainerSize({
          width: containerRef.current.clientWidth || window.innerWidth,
          height: containerRef.current.clientHeight || window.innerHeight
        });
      } else {
        setContainerSize({
          width: window.innerWidth,
          height: window.innerHeight
        });
      }
    };
    
    updateSize();
    window.addEventListener('resize', updateSize);
    const timer = setTimeout(updateSize, 100);
    
    return () => {
      window.removeEventListener('resize', updateSize);
      clearTimeout(timer);
    };
  }, []);

  const COLUMNS = 6;
  const ROWS = 5;
  const GAP = 6;
  const PADDING = 6;
  const TOOLBAR_HEIGHT = 60;
  
  const contentHeight = containerSize.height - TOOLBAR_HEIGHT;
  const rowHeight = Math.floor((contentHeight - PADDING * 2 - GAP * (ROWS - 1)) / ROWS);

  // 处理滚动 - 虚拟化渲染
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    
    const scrollTop = scrollRef.current.scrollTop;
    const viewportHeight = scrollRef.current.clientHeight;
    
    const itemHeight = rowHeight + GAP;
    const startRow = Math.floor(scrollTop / itemHeight);
    const endRow = Math.ceil((scrollTop + viewportHeight) / itemHeight);
    
    const buffer = 2;
    const start = Math.max(0, (startRow - buffer) * COLUMNS);
    const end = Math.min(images.length, (endRow + buffer) * COLUMNS);
    
    setVisibleRange({ start, end });
  }, [rowHeight, images.length]);

  useEffect(() => {
    const scrollEl = scrollRef.current;
    if (scrollEl) {
      scrollEl.addEventListener('scroll', handleScroll);
      handleScroll();
      return () => scrollEl.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  // 使用 File System Access API 选择文件夹
  const handleSelectDirectoryWithAPI = useCallback(async () => {
    try {
      // @ts-ignore
      directoryHandle = await window.showDirectoryPicker();
      if (!directoryHandle) return;

      setLoading(true);
      setUseFileSystemAPI(true);
      
      const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
      const imageFiles: { handle: FileSystemFileHandle; file: File }[] = [];

      // 递归读取目录
      const readDirectory = async (dirHandle: FileSystemDirectoryHandle) => {
        // @ts-ignore
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file') {
            const fileName = entry.name.toLowerCase();
            const ext = fileName.substring(fileName.lastIndexOf('.'));
            if (imageExtensions.includes(ext)) {
              try {
                const file = await entry.getFile();
                imageFiles.push({ handle: entry, file });
              } catch (e) {
                console.error('读取文件失败:', entry.name);
              }
            }
          }
        }
      };

      await readDirectory(directoryHandle);
      
      imageFiles.sort((a, b) => a.file.name.localeCompare(b.file.name));
      setLoadingProgress({ current: 0, total: imageFiles.length });

      const batchSize = 8;
      const loadedImages: ImageFile[] = [];
      
      for (let i = 0; i < imageFiles.length; i += batchSize) {
        const batch = imageFiles.slice(i, i + batchSize);
        
        const batchResults = await Promise.all(
          batch.map(async ({ handle, file }) => {
            const id = generateId();
            const url = URL.createObjectURL(file);
            let thumbnail = url;
            
            try {
              thumbnail = await createThumbnail(file, 200);
            } catch (err) {
              // 使用原图
            }
            
            return {
              id,
              name: file.name,
              url,
              thumbnail,
              fileHandle: handle,
              file
            };
          })
        );
        
        loadedImages.push(...batchResults);
        setLoadingProgress({ current: Math.min(i + batchSize, imageFiles.length), total: imageFiles.length });
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      
      setImages(loadedImages);
      setSelectedIds(new Set());
      setVisibleRange({ start: 0, end: Math.min(50, loadedImages.length) });
      setLoading(false);
      
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        console.error('选择文件夹失败:', err);
        showToast('选择文件夹失败，请使用传统方式');
      }
      setLoading(false);
    }
  }, []);

  // 传统方式选择文件
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setLoading(true);
    setUseFileSystemAPI(false);
    directoryHandle = null;
    setLoadingProgress({ current: 0, total: 0 });
    
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.ico'];
    const imageFilesList: File[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileName = file.name.toLowerCase();
      const lastDot = fileName.lastIndexOf('.');
      if (lastDot === -1) continue;
      const ext = fileName.substring(lastDot);
      if (imageExtensions.includes(ext)) {
        imageFilesList.push(file);
      }
    }

    imageFilesList.sort((a, b) => a.name.localeCompare(b.name));
    setLoadingProgress({ current: 0, total: imageFilesList.length });

    const batchSize = 8;
    const loadedImages: ImageFile[] = [];
    
    for (let i = 0; i < imageFilesList.length; i += batchSize) {
      const batch = imageFilesList.slice(i, i + batchSize);
      
      const batchResults = await Promise.all(
        batch.map(async (file) => {
          const id = generateId();
          const url = URL.createObjectURL(file);
          let thumbnail = url;
          
          try {
            thumbnail = await createThumbnail(file, 200);
          } catch (err) {
            // 使用原图
          }
          
          return {
            id,
            name: file.name,
            url,
            thumbnail,
            file
          };
        })
      );
      
      loadedImages.push(...batchResults);
      setLoadingProgress({ current: Math.min(i + batchSize, imageFilesList.length), total: imageFilesList.length });
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    
    setImages(loadedImages);
    setSelectedIds(new Set());
    setVisibleRange({ start: 0, end: Math.min(50, loadedImages.length) });
    setLoading(false);
    e.target.value = '';
  }, []);

  // 真实删除文件
  const deleteImageReal = useCallback(async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    
    const imageToDelete = images.find(img => img.id === id);
    if (!imageToDelete) return;

    // 如果使用 File System Access API，尝试真实删除
    if (useFileSystemAPI && directoryHandle && imageToDelete.fileHandle) {
      try {
        await directoryHandle.removeEntry(imageToDelete.name);
        showToast('已删除: ' + imageToDelete.name);
      } catch (err) {
        console.error('删除文件失败:', err);
        showToast('删除失败，已从预览中移除');
      }
    } else {
      showToast('已从预览移除: ' + imageToDelete.name);
    }

    // 释放资源
    try {
      URL.revokeObjectURL(imageToDelete.url);
    } catch (err) {}

    setImages(prev => prev.filter(img => img.id !== id));
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      newSet.delete(id);
      return newSet;
    });
  }, [images, useFileSystemAPI]);

  // 批量删除
  const deleteSelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    
    const idsToDelete = Array.from(selectedIds);
    let deletedCount = 0;
    let failedCount = 0;

    for (const id of idsToDelete) {
      const img = images.find(i => i.id === id);
      if (!img) continue;

      if (useFileSystemAPI && directoryHandle && img.fileHandle) {
        try {
          await directoryHandle.removeEntry(img.name);
          deletedCount++;
        } catch (err) {
          failedCount++;
        }
      } else {
        deletedCount++;
      }

      try {
        URL.revokeObjectURL(img.url);
      } catch (err) {}
    }

    setImages(prev => prev.filter(img => !selectedIds.has(img.id)));
    setSelectedIds(new Set());

    if (useFileSystemAPI) {
      if (failedCount > 0) {
        showToast(`已删除 ${deletedCount} 个文件，${failedCount} 个失败`);
      } else {
        showToast(`已删除 ${deletedCount} 个文件`);
      }
    } else {
      showToast(`已从预览移除 ${deletedCount} 张图片`);
    }
  }, [selectedIds, images, useFileSystemAPI]);

  // 复制选中的图片
  const copySelected = useCallback(async () => {
    if (selectedIds.size === 0) return;
    
    const selectedImages = images.filter(img => selectedIds.has(img.id));
    
    if (selectedImages.length === 1 && selectedImages[0].file) {
      try {
        const file = selectedImages[0].file;
        const blob = new Blob([await file.arrayBuffer()], { type: file.type });
        await navigator.clipboard.write([
          new ClipboardItem({ [blob.type]: blob })
        ]);
        showToast('已复制 1 张图片到剪贴板');
        return;
      } catch (err) {
        console.error('复制失败:', err);
      }
    }
    
    const names = selectedImages.map(img => img.name).join('\n');
    try {
      await navigator.clipboard.writeText(names);
      showToast('已复制 ' + selectedImages.length + ' 个文件名');
    } catch (err) {
      const textarea = document.createElement('textarea');
      textarea.value = names;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      showToast('已复制 ' + selectedImages.length + ' 个文件名');
    }
  }, [selectedIds, images]);

  const [toast, setToast] = useState<string | null>(null);
  const showToast = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(null), 2000);
  };

  const toggleSelect = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === images.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(images.map(img => img.id)));
    }
  }, [selectedIds.size, images]);

  // 打开图片预览 - 使用文件重新生成URL确保可用
  const openImagePreview = useCallback(async (image: ImageFile) => {
    setSelectedImage(image);
    
    // 如果有文件对象，重新创建URL确保可用
    if (image.file) {
      const newUrl = URL.createObjectURL(image.file);
      setPreviewUrl(newUrl);
    } else if (image.fileHandle) {
      try {
        const file = await image.fileHandle.getFile();
        const newUrl = URL.createObjectURL(file);
        setPreviewUrl(newUrl);
      } catch (err) {
        setPreviewUrl(image.url);
      }
    } else {
      setPreviewUrl(image.url);
    }
  }, []);

  const closeImagePreview = useCallback(() => {
    if (previewUrl && previewUrl !== selectedImage?.url) {
      URL.revokeObjectURL(previewUrl);
    }
    setSelectedImage(null);
    setPreviewUrl('');
  }, [previewUrl, selectedImage]);

  // 键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedImage) {
        closeImagePreview();
      }
      if (e.ctrlKey && e.key === 'a' && images.length > 0 && !selectedImage) {
        e.preventDefault();
        setSelectedIds(new Set(images.map(img => img.id)));
      }
      if (e.key === 'Delete' && selectedIds.size > 0 && !selectedImage) {
        deleteSelected();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedImage, closeImagePreview, images, selectedIds, deleteSelected]);

  const hasSelection = selectedIds.size > 0;
  const totalRows = Math.ceil(images.length / COLUMNS);
  const totalHeight = totalRows * (rowHeight + GAP) - GAP + PADDING * 2;

  return (
    <div 
      ref={containerRef}
      style={{
        width: '100%',
        height: '100vh',
        backgroundColor: '#111827',
        color: 'white',
        overflow: 'hidden',
        fontFamily: 'Arial, sans-serif',
        position: 'relative'
      }}
    >
      {/* 顶部工具栏 */}
      <div style={{
        height: TOOLBAR_HEIGHT + 'px',
        backgroundColor: '#1f2937',
        borderBottom: '1px solid #374151',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        boxSizing: 'border-box'
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '18px', fontWeight: 'bold' }}>📷 图片预览工具</span>
          <span style={{ color: '#9ca3af', fontSize: '14px' }}>
            {loading ? '加载中...' : images.length > 0 ? '共 ' + images.length + ' 张' : ''}
          </span>
          {useFileSystemAPI && images.length > 0 && (
            <span style={{ 
              color: '#34d399', 
              fontSize: '12px',
              backgroundColor: '#064e3b',
              padding: '2px 6px',
              borderRadius: '4px'
            }}>
              ✓ 可真实删除
            </span>
          )}
          {hasSelection && (
            <span style={{ 
              color: '#60a5fa', 
              fontSize: '14px',
              backgroundColor: '#1e3a5f',
              padding: '2px 8px',
              borderRadius: '4px'
            }}>
              已选 {selectedIds.size} 张
            </span>
          )}
        </div>
        
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {images.length > 0 && (
            <>
              <button
                onClick={toggleSelectAll}
                style={{
                  padding: '6px 10px',
                  backgroundColor: selectedIds.size === images.length ? '#4b5563' : '#374151',
                  color: 'white',
                  border: '1px solid #4b5563',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '12px'
                }}
              >
                {selectedIds.size === images.length ? '☑取消' : '☐全选'}
              </button>
              
              {hasSelection && (
                <>
                  <button
                    onClick={copySelected}
                    style={{
                      padding: '6px 10px',
                      backgroundColor: '#0891b2',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    📋复制({selectedIds.size})
                  </button>
                  
                  <button
                    onClick={deleteSelected}
                    style={{
                      padding: '6px 10px',
                      backgroundColor: '#dc2626',
                      color: 'white',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: 'pointer',
                      fontSize: '12px'
                    }}
                  >
                    🗑删除({selectedIds.size})
                  </button>
                </>
              )}
            </>
          )}
          
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
          />
          
          <input
            ref={folderInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            style={{ display: 'none' }}
            {...{ webkitdirectory: '', directory: '' } as any}
          />
          
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={loading}
            style={{
              padding: '6px 12px',
              backgroundColor: '#2563eb',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontSize: '13px',
              fontWeight: 500,
              opacity: loading ? 0.6 : 1
            }}
          >
            📁选择图片
          </button>
          
          {supportsFileSystemAccess() ? (
            <button
              onClick={handleSelectDirectoryWithAPI}
              disabled={loading}
              style={{
                padding: '6px 12px',
                backgroundColor: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1
              }}
              title="使用此方式可真实删除文件"
            >
              📂文件夹(可删除)
            </button>
          ) : (
            <button
              onClick={() => folderInputRef.current?.click()}
              disabled={loading}
              style={{
                padding: '6px 12px',
                backgroundColor: '#059669',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'not-allowed' : 'pointer',
                fontSize: '13px',
                fontWeight: 500,
                opacity: loading ? 0.6 : 1
              }}
            >
              📂选择文件夹
            </button>
          )}
        </div>
      </div>

      {/* 图片网格区域 */}
      <div 
        ref={scrollRef}
        style={{
          height: contentHeight + 'px',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxSizing: 'border-box'
        }}
      >
        {images.length > 0 ? (
          <div style={{
            position: 'relative',
            height: totalHeight + 'px',
            padding: PADDING + 'px',
            boxSizing: 'border-box'
          }}>
            {images.map((image, index) => {
              if (index < visibleRange.start || index >= visibleRange.end) {
                return null;
              }
              
              const row = Math.floor(index / COLUMNS);
              const col = index % COLUMNS;
              const itemWidth = (containerSize.width - PADDING * 2 - GAP * (COLUMNS - 1)) / COLUMNS;
              const left = col * (itemWidth + GAP);
              const top = row * (rowHeight + GAP);
              
              const isSelected = selectedIds.has(image.id);
              
              return (
                <div
                  key={image.id}
                  onClick={() => openImagePreview(image)}
                  style={{
                    position: 'absolute',
                    left: left + 'px',
                    top: top + 'px',
                    width: itemWidth + 'px',
                    height: rowHeight + 'px',
                    backgroundColor: '#374151',
                    borderRadius: '4px',
                    overflow: 'hidden',
                    cursor: 'pointer',
                    border: isSelected ? '2px solid #3b82f6' : '1px solid #4b5563',
                    boxSizing: 'border-box'
                  }}
                >
                  <img
                    src={image.thumbnail}
                    alt={image.name}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      display: 'block'
                    }}
                    loading="lazy"
                  />
                  
                  {/* 左上角复选框 */}
                  <div
                    onClick={(e) => toggleSelect(image.id, e)}
                    style={{
                      position: 'absolute',
                      top: '3px',
                      left: '3px',
                      width: '16px',
                      height: '16px',
                      backgroundColor: isSelected ? '#3b82f6' : 'rgba(0,0,0,0.5)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '10px',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.5)'
                    }}
                  >
                    {isSelected ? '✓' : ''}
                  </div>
                  
                  {/* 左下角垃圾桶 - 更小 */}
                  <div
                    onClick={(e) => deleteImageReal(image.id, e)}
                    style={{
                      position: 'absolute',
                      bottom: '3px',
                      left: '3px',
                      width: '16px',
                      height: '16px',
                      backgroundColor: 'rgba(220,38,38,0.8)',
                      borderRadius: '2px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      fontSize: '8px'
                    }}
                    onMouseOver={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(185,28,28,1)';
                    }}
                    onMouseOut={(e) => {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor = 'rgba(220,38,38,0.8)';
                    }}
                    title={useFileSystemAPI ? "删除此文件" : "从预览移除"}
                  >
                    🗑
                  </div>
                  
                  {/* 右下角文件名 */}
                  <div style={{
                    position: 'absolute',
                    bottom: 0,
                    right: 0,
                    left: '22px',
                    background: 'linear-gradient(to top, rgba(0,0,0,0.8), transparent)',
                    padding: '10px 4px 2px 4px',
                    boxSizing: 'border-box'
                  }}>
                    <div style={{
                      fontSize: '9px',
                      color: 'white',
                      textAlign: 'right',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }} title={image.name}>
                      {image.name}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#9ca3af'
          }}>
            <div style={{ fontSize: '64px', marginBottom: '16px' }}>🖼️</div>
            <h2 style={{ fontSize: '20px', marginBottom: '8px', color: '#e5e7eb' }}>暂无图片</h2>
            <p style={{ color: '#6b7280', marginBottom: '24px' }}>点击上方按钮选择图片或文件夹</p>
            <div style={{
              backgroundColor: '#1f2937',
              borderRadius: '8px',
              padding: '16px 24px',
              maxWidth: '480px',
              textAlign: 'left',
              fontSize: '14px',
              lineHeight: '1.8'
            }}>
              <p style={{ fontWeight: 'bold', marginBottom: '8px', color: '#e5e7eb' }}>使用说明：</p>
              <p>• 点击"选择图片"可多选图片文件</p>
              <p>• 点击"文件夹(可删除)"可选择文件夹并支持真实删除</p>
              <p>• 点击图片可放大查看原图</p>
              <p>• 左上角复选框可多选，左下角🗑可删除</p>
              <p>• 快捷键：Ctrl+A全选，Delete删除，ESC关闭</p>
              <p style={{ color: '#f59e0b', marginTop: '8px' }}>
                ⚠️ 使用"文件夹(可删除)"按钮选择的图片可以真实删除文件
              </p>
            </div>
          </div>
        )}
      </div>

      {/* 图片放大预览模态框 */}
      {selectedImage && (
        <div 
          onClick={closeImagePreview}
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            cursor: 'pointer'
          }}
        >
          <button
            onClick={closeImagePreview}
            style={{
              position: 'absolute',
              top: '16px',
              right: '16px',
              width: '40px',
              height: '40px',
              backgroundColor: 'rgba(255,255,255,0.2)',
              border: 'none',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '20px',
              color: 'white',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            ✕
          </button>
          
          <div 
            onClick={(e) => e.stopPropagation()}
            style={{
              maxWidth: '95%',
              maxHeight: '95%',
              position: 'relative',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center'
            }}
          >
            {previewUrl ? (
              <img
                src={previewUrl}
                alt={selectedImage.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '85vh',
                  objectFit: 'contain',
                  borderRadius: '4px',
                  boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                }}
                onError={() => {
                  // 如果加载失败，尝试使用缩略图
                  if (previewUrl !== selectedImage.thumbnail) {
                    setPreviewUrl(selectedImage.thumbnail);
                  }
                }}
              />
            ) : (
              <div style={{ color: 'white', fontSize: '18px' }}>加载中...</div>
            )}
            <div style={{
              marginTop: '12px',
              padding: '8px 16px',
              backgroundColor: 'rgba(0,0,0,0.6)',
              borderRadius: '4px',
              textAlign: 'center'
            }}>
              <p style={{ color: 'white', fontSize: '14px', margin: 0 }}>{selectedImage.name}</p>
            </div>
          </div>
        </div>
      )}

      {/* Toast 提示 */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          backgroundColor: '#1f2937',
          color: 'white',
          padding: '12px 24px',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          zIndex: 1001,
          fontSize: '14px',
          border: '1px solid #374151'
        }}>
          {toast}
        </div>
      )}

      {/* 加载遮罩 */}
      {loading && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 999
        }}>
          <div style={{
            backgroundColor: '#1f2937',
            padding: '24px 48px',
            borderRadius: '12px',
            textAlign: 'center',
            minWidth: '250px'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
            <p style={{ color: '#e5e7eb', margin: '0 0 12px 0' }}>正在加载图片...</p>
            {loadingProgress.total > 0 && (
              <>
                <div style={{
                  width: '100%',
                  height: '8px',
                  backgroundColor: '#374151',
                  borderRadius: '4px',
                  overflow: 'hidden'
                }}>
                  <div style={{
                    width: (loadingProgress.current / loadingProgress.total * 100) + '%',
                    height: '100%',
                    backgroundColor: '#3b82f6',
                    transition: 'width 0.2s'
                  }} />
                </div>
                <p style={{ color: '#9ca3af', fontSize: '12px', margin: '8px 0 0 0' }}>
                  {loadingProgress.current} / {loadingProgress.total}
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
