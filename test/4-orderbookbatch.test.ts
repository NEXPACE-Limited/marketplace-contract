import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { now, day, orderbookSignBuyer, orderbookSignSeller } from "./lib";
import nxErrors from "./lib/nx-errors";

describe("OrderBook", function () {
  async function fixture() {
    const index = 0;
    const nowTime = await now();
    const zeroAddress = ethers.constants.AddressZero;
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const [owner, b1, b2, b3, b4, b5, seller] = await ethers.getSigners();
    const [OrderBook, ERC20PresetFixedSupply, MockMSU721, Commission] = await Promise.all([
      ethers.getContractFactory("OrderBook"),
      ethers.getContractFactory("ERC20PresetFixedSupply"),
      ethers.getContractFactory("MockMSU721"),
      ethers.getContractFactory("Commission"),
    ]);

    const [erc20PresetFixedSupply, erc721PresetMinterPauserAutoId] = await Promise.all([
      ERC20PresetFixedSupply.deploy("ERC20", "ERC20", 30000, await b1.getAddress()),
      MockMSU721.deploy(),
    ]);

    const commission = await Commission.deploy(owner.address, erc20PresetFixedSupply.address);
    await commission.connect(owner).deployed();
    const orderbook = await OrderBook.deploy(commission.address, erc20PresetFixedSupply.address);
    const itemId = 123;

    const defaultSellerOrder = {
      maker: await seller.getAddress(),
      listingTime: nowTime - 5 * day,
      currencyAddress: erc20PresetFixedSupply.address,
      perPrice: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      // nftTokenIds: [0, 1, 2, 3],
      nftTokenIds: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24],
      salt: index,
    };

    const defaultBuyerOrder = {
      maker: await b1.getAddress(),
      listingTime: nowTime - 5 * day,
      currencyAddress: erc20PresetFixedSupply.address,
      perPrice: 100,
      nftAddress: erc721PresetMinterPauserAutoId.address,
      itemId: itemId,
      purchaseAmount: 5,
      salt: index,
    };

    const contentsCommissionInformation = {
      commissionTo: await owner.getAddress(),
      commissionPercentage: 500,
      dAppId: 0,
    };

    for (let i = 0; i < 25; i++) {
      await erc721PresetMinterPauserAutoId.mint(seller.address, itemId, i);
    }

    await Promise.all([
      await erc20PresetFixedSupply.connect(b1).transfer(b2.address, 1000),
      await erc20PresetFixedSupply.connect(b1).transfer(b3.address, 1000),
      await erc20PresetFixedSupply.connect(b1).transfer(b4.address, 1000),
      await erc20PresetFixedSupply.connect(b1).transfer(b5.address, 1000),
      await erc20PresetFixedSupply.connect(b1).approve(orderbook.address, 100000),
      await erc20PresetFixedSupply.connect(b2).approve(orderbook.address, 1000),
      await erc20PresetFixedSupply.connect(b3).approve(orderbook.address, 1000),
      await erc20PresetFixedSupply.connect(b4).approve(orderbook.address, 1000),
      await erc20PresetFixedSupply.connect(b5).approve(orderbook.address, 1000),
      await erc20PresetFixedSupply.connect(seller).approve(orderbook.address, 1000000),
      await erc721PresetMinterPauserAutoId.connect(seller).setApprovalForAll(orderbook.address, true),
    ]);

    return {
      index,
      nowTime,
      chainId,
      zeroAddress,
      owner,
      b1,
      b2,
      b3,
      b4,
      b5,
      seller,
      itemId,
      commission,
      orderbook,
      erc20PresetFixedSupply,
      erc721PresetMinterPauserAutoId,
      defaultSellerOrder,
      defaultBuyerOrder,
      contentsCommissionInformation,
    };
  }

  before(async () => {
    await loadFixture(fixture);
  });

  describe("Success case", function () {
    it("Fixed price order match", async () => {
      const {
        chainId,
        seller,
        b1,
        b2,
        b3,
        b4,
        b5,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
        erc20PresetFixedSupply,
        erc721PresetMinterPauserAutoId,
        commission,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const sellerHash = await orderbook.hashOrderBookSeller(sellerOrder);
      const bo1 = { ...defaultBuyerOrder };
      const bo2 = { ...defaultBuyerOrder, maker: b2.address };
      const bo3 = { ...defaultBuyerOrder, maker: b3.address };
      const bo4 = { ...defaultBuyerOrder, maker: b4.address };
      const bo5 = { ...defaultBuyerOrder, maker: b5.address };
      const b1Hash = await orderbook.hashOrderBookBuyer(bo1);
      const b2Hash = await orderbook.hashOrderBookBuyer(bo2);
      const b3Hash = await orderbook.hashOrderBookBuyer(bo3);
      const b4Hash = await orderbook.hashOrderBookBuyer(bo4);
      const b5Hash = await orderbook.hashOrderBookBuyer(bo5);

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const bs1 = await orderbookSignBuyer(chainId, orderbook.address, b1, bo1);
      const bs2 = await orderbookSignBuyer(chainId, orderbook.address, b2, bo2);
      const bs3 = await orderbookSignBuyer(chainId, orderbook.address, b3, bo3);
      const bs4 = await orderbookSignBuyer(chainId, orderbook.address, b4, bo4);
      const bs5 = await orderbookSignBuyer(chainId, orderbook.address, b5, bo5);

      const txn = await orderbook.orderBatchMatch(
        sellerOrder,
        [bo1, bo2, bo3, bo4, bo5],
        sellerSig,
        [bs1, bs2, bs3, bs4, bs5],
        contentsCommissionInformation
      );

      await txn.wait();

      expect(await erc20PresetFixedSupply.balanceOf(await b1.getAddress())).equal(25500);
      expect(await erc20PresetFixedSupply.balanceOf(await b2.getAddress())).equal(500);
      expect(await erc20PresetFixedSupply.balanceOf(await b3.getAddress())).equal(500);
      expect(await erc20PresetFixedSupply.balanceOf(await b4.getAddress())).equal(500);
      expect(await erc20PresetFixedSupply.balanceOf(await b5.getAddress())).equal(500);
      expect(await erc20PresetFixedSupply.balanceOf(await seller.getAddress())).equal(2375);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(125);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b1.getAddress())).equal(5);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b2.getAddress())).equal(5);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b3.getAddress())).equal(5);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b4.getAddress())).equal(5);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b5.getAddress())).equal(5);
      expect(await orderbook.fillsAmounts(sellerHash)).equal(25);
      expect(await orderbook.fillsAmounts(b1Hash)).equal(5);
      expect(await orderbook.fillsAmounts(b2Hash)).equal(5);
      expect(await orderbook.fillsAmounts(b3Hash)).equal(5);
      expect(await orderbook.fillsAmounts(b4Hash)).equal(5);
      expect(await orderbook.fillsAmounts(b5Hash)).equal(5);
    });
    it("Fixed price order match - sufficient amount", async () => {
      const {
        chainId,
        seller,
        b1,
        b2,
        b3,
        b4,
        b5,
        orderbook,
        defaultSellerOrder,
        defaultBuyerOrder,
        contentsCommissionInformation,
        erc20PresetFixedSupply,
        erc721PresetMinterPauserAutoId,
        commission,
      } = await loadFixture(fixture);

      const sellerOrder = defaultSellerOrder;
      const sellerHash = await orderbook.hashOrderBookSeller(sellerOrder);
      const bo1 = { ...defaultBuyerOrder, purchaseAmount: 15 };
      const bo2 = { ...defaultBuyerOrder, maker: b2.address, purchaseAmount: 4 };
      const bo3 = { ...defaultBuyerOrder, maker: b3.address, purchaseAmount: 1 };
      const bo4 = { ...defaultBuyerOrder, maker: b4.address, purchaseAmount: 3 };
      const bo5 = { ...defaultBuyerOrder, maker: b5.address, purchaseAmount: 6 };
      const b1Hash = await orderbook.hashOrderBookBuyer(bo1);
      const b2Hash = await orderbook.hashOrderBookBuyer(bo2);
      const b3Hash = await orderbook.hashOrderBookBuyer(bo3);
      const b4Hash = await orderbook.hashOrderBookBuyer(bo4);
      const b5Hash = await orderbook.hashOrderBookBuyer(bo5);

      const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
      const bs1 = await orderbookSignBuyer(chainId, orderbook.address, b1, bo1);
      const bs2 = await orderbookSignBuyer(chainId, orderbook.address, b2, bo2);
      const bs3 = await orderbookSignBuyer(chainId, orderbook.address, b3, bo3);
      const bs4 = await orderbookSignBuyer(chainId, orderbook.address, b4, bo4);
      const bs5 = await orderbookSignBuyer(chainId, orderbook.address, b5, bo5);

      const txn = await orderbook.orderBatchMatch(
        sellerOrder,
        [bo1, bo2, bo3, bo4, bo5],
        sellerSig,
        [bs1, bs2, bs3, bs4, bs5],
        contentsCommissionInformation
      );

      await txn.wait();

      expect(await erc20PresetFixedSupply.balanceOf(await b1.getAddress())).equal(24500);
      expect(await erc20PresetFixedSupply.balanceOf(await b2.getAddress())).equal(600);
      expect(await erc20PresetFixedSupply.balanceOf(await b3.getAddress())).equal(900);
      expect(await erc20PresetFixedSupply.balanceOf(await b4.getAddress())).equal(700);
      expect(await erc20PresetFixedSupply.balanceOf(await b5.getAddress())).equal(800);
      expect(await erc20PresetFixedSupply.balanceOf(await seller.getAddress())).equal(2355);
      expect(await erc20PresetFixedSupply.balanceOf(commission.address)).equal(145);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b1.getAddress())).equal(15);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b2.getAddress())).equal(4);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b3.getAddress())).equal(1);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b4.getAddress())).equal(3);
      expect(await erc721PresetMinterPauserAutoId.balanceOf(await b5.getAddress())).equal(2);
      expect(await orderbook.fillsAmounts(sellerHash)).equal(25);
      expect(await orderbook.fillsAmounts(b1Hash)).equal(15);
      expect(await orderbook.fillsAmounts(b2Hash)).equal(4);
      expect(await orderbook.fillsAmounts(b3Hash)).equal(1);
      expect(await orderbook.fillsAmounts(b4Hash)).equal(3);
      expect(await orderbook.fillsAmounts(b5Hash)).equal(2);
    });
    describe("Fail case", function () {
      it("Not executor - orderBatchMatch", async () => {
        const { chainId, seller, b1, orderbook, defaultSellerOrder, defaultBuyerOrder, contentsCommissionInformation } =
          await loadFixture(fixture);

        const sellerOrder = defaultSellerOrder;
        const buyerOrder = defaultBuyerOrder;

        const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
        const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, b1, buyerOrder);

        const txn = orderbook
          .connect(seller)
          .orderBatchMatch(sellerOrder, [buyerOrder], sellerSig, [buyerSig], contentsCommissionInformation);

        await expect(txn).to.be.revertedWith(nxErrors.executorForbidden);
      });
      it("Wrong commissionTo", async () => {
        const {
          chainId,
          seller,
          b1,
          orderbook,
          defaultSellerOrder,
          defaultBuyerOrder,
          contentsCommissionInformation,
          zeroAddress,
        } = await loadFixture(fixture);

        const sellerOrder = defaultSellerOrder;
        const buyerOrder = defaultBuyerOrder;
        const wrongCommission = {
          ...contentsCommissionInformation,
          commissionTo: zeroAddress,
        };

        const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
        const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, b1, buyerOrder);

        const txn = orderbook.orderBatchMatch(sellerOrder, [buyerOrder], sellerSig, [buyerSig], wrongCommission);

        await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
      });
      it("Wrong commissionPercentage", async () => {
        const { chainId, seller, b1, orderbook, defaultSellerOrder, defaultBuyerOrder, contentsCommissionInformation } =
          await loadFixture(fixture);

        const sellerOrder = defaultSellerOrder;
        const buyerOrder = defaultBuyerOrder;
        const wrongCommission = {
          ...contentsCommissionInformation,
          commissionPercentage: 10001,
        };

        const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
        const buyerSig = await orderbookSignBuyer(chainId, orderbook.address, b1, buyerOrder);

        const txn = orderbook.orderBatchMatch(sellerOrder, [buyerOrder], sellerSig, [buyerSig], wrongCommission);

        await expect(txn).to.be.revertedWith(nxErrors.invalidRequest);
      });
      it("Not enough buyer token", async () => {
        const {
          chainId,
          seller,
          b1,
          b2,
          b3,
          orderbook,
          defaultSellerOrder,
          defaultBuyerOrder,
          contentsCommissionInformation,
          erc20PresetFixedSupply,
        } = await loadFixture(fixture);
        await erc20PresetFixedSupply.connect(b3).transfer(b2.address, 1000);

        const sellerOrder = defaultSellerOrder;
        const bo1 = { ...defaultBuyerOrder };
        const bo2 = { ...defaultBuyerOrder, maker: b2.address };
        const bo3 = { ...defaultBuyerOrder, maker: b3.address };

        const sellerSig = await orderbookSignSeller(chainId, orderbook.address, seller, sellerOrder);
        const bs1 = await orderbookSignBuyer(chainId, orderbook.address, b1, bo1);
        const bs2 = await orderbookSignBuyer(chainId, orderbook.address, b2, bo2);
        const bs3 = await orderbookSignBuyer(chainId, orderbook.address, b3, bo3);

        const txn = orderbook.orderBatchMatch(
          sellerOrder,
          [bo1, bo2, bo3],
          sellerSig,
          [bs1, bs2, bs3],
          contentsCommissionInformation
        );

        await expect(txn).to.be.revertedWith(nxErrors.OrderMatch.transferNoFund);
      });
    });
  });
});
