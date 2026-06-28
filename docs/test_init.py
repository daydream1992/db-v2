import sys
sys.path.insert(0, r'K:\txdlianghua\PYPlugins\user')
import tqcenter

try:
    tqcenter.tq.initialize(__file__)
    print('初始化成功')
    result = tqcenter.tq.get_relation('600519.SH')
    print(f'返回: {len(result)} 条')
except Exception as e:
    print(f'错误: {e}')
    import traceback
    traceback.print_exc()