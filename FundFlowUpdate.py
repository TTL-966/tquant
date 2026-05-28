from backend.db import Database
from backend.data_updater.fund_flow_updater import FundFlowUpdater

db = Database()
updater = FundFlowUpdater(db.engine)
if updater.needs_update():
    success, msg = updater.run()
    print(msg)
else:
    print("今日数据已是最新")